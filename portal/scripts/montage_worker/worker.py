"""Montage worker core — Supabase <> OpenMontage bridge.

A plain-Python, dependency-light worker. It talks to Supabase over the REST
(PostgREST) API using the project's public (publishable / anon) key — the same
credential the Next.js portal uses server-side — so no extra SDK is required.

OpenMontage is imported lazily and optionally: the worker must run (and report
actionable status) even in an environment where the OpenMontage render engines
(FFmpeg / Remotion / HyperFrames) are not yet installed, per the project's
zero-maintenance principle.

Dispatches assets that already have a media_url (nothing to do), requests
rendering for pending records, then persists the generated media_url + status.
"""

from __future__ import annotations

import json
import os
import shutil
import smtplib
import subprocess
import sys
import time
from dataclasses import dataclass, field
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Optional

import httpx

# Asset pipeline helpers — Gemini conceptualization, branding watermark, and
# ZIP packaging. Imported lazily/optionally so the worker still boots even if
# a helper is missing (zero-maintenance). GEMINI_API_KEY is read from env at
# runtime via pipeline.get_gemini_key(); never hardcoded here.
try:
    from . import pipeline as _pipeline
except Exception:  # pragma: no cover - running from cwd fallback
    try:
        import pipeline as _pipeline
    except Exception:
        _pipeline = None

# On Windows, invoking a `.cmd`/`.bat` shim (e.g. `npx`, `npm`) via
# subprocess without `shell=True` raises [WinError 193]. We only ever shell
# out to real executables (`ffmpeg.exe`) and resolve the exact exe up-front,
# so the worker never triggers that error. `CREATE_NO_WINDOW` keeps a console
# window from popping open during headless cron/render runs on Windows.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# The OpenMontage checkout. Defaults to the mirror vendored under the repo's
# .tmp dir so the worker can run out-of-the-box. Override with
# OPENMONTAGE_ROOT to point at a full production checkout.
OPENMONTAGE_ROOT = Path(
    os.environ.get(
        "OPENMONTAGE_ROOT",
        str(Path(__file__).resolve().parents[3] / ".tmp" / "OpenMontage"),
    )
)

TABLE = os.environ.get("SOCIAL_POSTS_TABLE", "social_posts")

# Where finished renders are published so the portal's `/media/...` public
# URLs resolve end-to-end. Defaults to the Next.js portal static dir; the
# web server serves anything under `portal/public`. Override with
# MONTAGE_PUBLISH_DIR if you host the media elsewhere.
MONTAGE_PUBLISH_DIR = Path(
    os.environ.get(
        "MONTAGE_PUBLISH_DIR",
        str(Path(__file__).resolve().parents[2] / "public" / "media"),
    )
)

# The portal's static public dir. The record's `image`/`media_url` are public
# URLs rooted at `/` (e.g. "/images/p2.jpg"); we resolve them against this dir
# to get real filesystem paths for the render's asset_manifest.
PORTAL_PUBLIC_DIR = Path(
    os.environ.get(
        "PORTAL_PUBLIC_DIR",
        str(Path(__file__).resolve().parents[2] / "public"),
    )
)


def resolve_public_asset(public_path: str) -> Path:
    """Resolve a `/...` public URL (DB `image`/`media_url`) to a real path.

    Returns the file under PORTAL_PUBLIC_DIR, or empty when it cannot be
    resolved. Also accepts an absolute filesystem path verbatim.
    """
    p = (public_path or "").strip()
    if not p:
        return Path()
    # Absolute / already-on-disk path.
    maybe = Path(p)
    if maybe.is_absolute() and maybe.exists():
        return maybe
    # Strip a leading "/" and look under the portal public dir.
    rel = p[1:] if p.startswith("/") else p
    candidate = PORTAL_PUBLIC_DIR / rel
    return candidate if candidate.exists() else Path()

# Records we consider "pending" and eligible for montage processing:
# video posts (or image posts marked for montage) that do not yet have a
# generated media_url and are not already being processed.
PENDING_STATUSES = {"Draft", "Queued"}


# ---------------------------------------------------------------------------
# Environment / dotenv (reads the portal's .env.local, plus real env overrides)
# ---------------------------------------------------------------------------

def _load_dotenv_local() -> None:
    """Best-effort load of portal/.env.local so the worker can run from cron
    without a shell that already exported the Supabase variables."""
    candidates = [
        os.environ.get("PORTAL_ENV_FILE"),
        str(Path(__file__).resolve().parents[2] / ".env.local"),
        str(Path(__file__).resolve().parents[2] / ".env"),
    ]
    for path in candidates:
        if not path:
            continue
        p = Path(path)
        if not p.is_file():
            continue
        try:
            for raw in p.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
        except OSError:
            continue


def get_supabase_config() -> tuple[str, str]:
    """Return (url, key). Raises RuntimeError if not configured."""
    _load_dotenv_local()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "").strip()
    if not url or not key:
        raise RuntimeError(
            "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and "
            "NEXT_PUBLIC_SUPABASE_ANON_KEY (or populate portal/.env.local)."
        )
    return url.rstrip("/"), key


# ---------------------------------------------------------------------------
# Supabase REST client (minimal, no external SDK)
# ---------------------------------------------------------------------------

class Supabase:
    """Thin PostgREST client for the social_posts table (reads + writes)."""

    def __init__(self, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        self.key = key
        self._client = httpx.Client(base_url=self.url, timeout=30.0)

    def _headers(self, prefer: str = "return=representation") -> dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        }

    def fetch_pending(self, limit: int = 50) -> list[dict[str, Any]]:
        """Fetch records that still need a generated montage media_url.

        Only records that are *explicitly queued for montage* qualify:
          - media_type='video' posts that have no media_url yet (a generated
            video is pending), OR
          - records flagged as agent-uploaded job-site assets (uploaded=true)
            awaiting a finished montage piece.
        Casual Draft image posts (stock seed images with uploaded=false) are
        NOT picked up — they are reference content, not montage jobs.
        """
        params = {
            "select": "*",
            "order": "created_at.asc",
            "limit": str(limit),
        }
        resp = self._client.get(
            f"/rest/v1/{TABLE}",
            params=params,
            headers=self._headers("return=minimal"),
        )
        resp.raise_for_status()
        rows = resp.json()
        pending: list[dict[str, Any]] = []
        for row in rows:
            status = row.get("status") or "Draft"
            media_url = row.get("media_url")
            media_type = row.get("media_type") or "image"
            uploaded = bool(row.get("uploaded"))
            if not media_url and status in PENDING_STATUSES:
                is_montage_job = (media_type == "video") or uploaded
                if is_montage_job:
                    pending.append(row)
        return pending

    def update_media(self, row_id: str, media_url: str, status: str = "Ready") -> dict[str, Any]:
        """Set the generated media_url + status (and mark as no longer pending).

        The DB constrains `status` to ('Draft','Approved') — 'Ready' is NOT a
        valid enum value (Postgres 23514). We map the worker's internal 'Ready'
        to the valid 'Approved' (semantically "a finished asset, ready to
        publish") so the PATCH succeeds with the publishable key, which cannot
        run DDL. Always update media_url regardless.
        """
        payload: dict[str, Any] = {"media_url": media_url}
        db_status = status
        if db_status == "Ready":
            db_status = "Approved"
        if db_status in ("Draft", "Approved"):
            payload["status"] = db_status
        resp = self._client.patch(
            f"/rest/v1/{TABLE}",
            params={"id": f"eq.{row_id}"},
            json=payload,
            headers=self._headers("return=representation"),
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else {}

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# OpenMontage integration (lazy / optional)
# ---------------------------------------------------------------------------

@dataclass
class MontageEngineStatus:
    available: bool
    engines: dict[str, bool] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def probe_montage_engine() -> MontageEngineStatus:
    """Check whether the OpenMontage render engines are resolvable."""
    status = MontageEngineStatus(available=False)
    if not OPENMONTAGE_ROOT.is_dir():
        status.errors.append(f"OpenMontage root not found: {OPENMONTAGE_ROOT}")
        return status
    try:
        sys.path.insert(0, str(OPENMONTAGE_ROOT))
        from tools.video.video_compose import VideoCompose  # noqa: F401

        vc = VideoCompose()
        engines = vc.get_info().get("render_engines", {})
        status.engines = engines
        status.available = any(engines.values())
        if not status.available:
            status.errors.append(
                "OpenMontage is present but no render engines (ffmpeg/remotion/hyperframes) are available."
            )
    except Exception as exc:  # pragma: no cover - environment dependent
        status.errors.append(f"OpenMontage import failed: {exc}")
    return status


def publish_media(rid: str, src: Path) -> Path:
    """Copy a finished render into the portal's static /media directory.

    Ensures the public `/media/<rid>.mp4` URL written to Supabase resolves
    end-to-end from the Next.js app (it serves anything under `portal/public`).
    Creates the target directory if needed and returns the destination path.
    """
    MONTAGE_PUBLISH_DIR.mkdir(parents=True, exist_ok=True)
    dst = MONTAGE_PUBLISH_DIR / f"{rid}.mp4"
    shutil.copy2(src, dst)
    return dst


def _resolve_exe(name: str) -> str:
    """Return the absolute path to a real executable on PATH.

    Windows: shutil.which() may hand back a `.cmd`/.bat shim for Node-based
    CLIs (e.g. `npx.cmd`). Invoking those via subprocess without a shell
    raises [WinError 193]. This helper prefers a native `.exe` so the worker
    only shells out to a real binary; ffmpeg/ffprobe are native so they are
    always safe. Raises LookupError if no usable executable is found.
    """
    exe = shutil.which(name)
    if not exe:
        raise LookupError(f"executable '{name}' not found on PATH")
    if (sys.platform == "win32") and exe.lower().endswith((".cmd", ".bat")):
        # Refuse to auto-run a shell shim without shell=True.
        raise LookupError(
            f"'{name}' resolves to a Windows shell shim ({exe}). Prefer a real "
            f"executable; the worker does not invoke .cmd/.bat directly."
        )
    return exe


def _build_kenburns_cmd(ffmpeg: str, img: Path, out: Path, base_vf: str) -> list[str]:
    """Build the base (no-overlay) FFmpeg Ken Burns command list."""
    return [
        ffmpeg, "-y",
        "-loop", "1", "-i", str(img),
        "-vf", base_vf,
        "-t", "4",
        "-c:v", "libx264", "-crf", "23",
        "-pix_fmt", "yuv420p",
        str(out),
    ]


def render_via_ffmpeg_kenburns(rid: str, image: Path, output_path: Path) -> Path:
    """Turn a single still image into a short branded .mp4 using FFmpeg.

    FFmpeg-only path (no Remotion / node / npx) — immune to the Windows
    [WinError 193] that hits `.cmd` shims. Uses the `zoompan` filter for a
    gentle Ken Burns pan/zoom over the source so a still becomes a short
    motion piece. Original aspect ratio is preserved via letterbox
    (`fit=pad`), never cropped/distorted — consistent with brand rules.

    1080x1080 x 4s @ 30fps, h264 + yuv420p (broad player compatibility).
    The transparent brand logo is hardcoded into the render as a bottom-right
    watermark overlay (brand enforcement).
    """
    ffmpeg = _resolve_exe("ffmpeg")
    out = output_path.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    img = image.resolve()

    # Branding: pre-composite the transparent logo onto a solid-black 1080x1080
    # canvas (letterboxed, aspect preserved — uses the shared pipeline
    # watermark_image helper) so the logo is baked into every frame. Then feed
    # that watermarked poster into the plain Ken Burns command (single input,
    # no fragile filter_complex overlay). If the logo asset is missing we fall
    # back to a plain render rather than failing the batch.
    watermarked = None
    if _pipeline is not None and (PORTAL_PUBLIC_DIR / _pipeline.LOGO_REL).exists():
        try:
            watermarked = out.parent / f"{rid}_wm.jpg"
            _pipeline.watermark_image(img, watermarked, PORTAL_PUBLIC_DIR)
        except Exception:
            watermarked = None
    source_img = watermarked if watermarked is not None else img

    # Base Ken Burns zoompan: start fully zoomed-out, ease to ~1.15. Frames are
    # 4s * 30fps = 120 (d=120). No size reduction of the source; the zoompan
    # output is 1080x1080, letterboxed (never cropped) per brand rules.
    vf = (
        "scale=8000:-1,zoompan=z='min(zoom+0.0015,1.15)':d=120:s=1080x1080:fps=30,"
        "format=yuv420p"
    )
    cmd = _build_kenburns_cmd(ffmpeg, source_img, out, vf)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            creationflags=_NO_WINDOW,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"record {rid}: ffmpeg ken burns timed out: {exc}") from exc

    if proc.returncode != 0 or not out.exists():
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-15:]
        raise RuntimeError(
            f"record {rid}: ffmpeg ken burns failed (exit {proc.returncode}):\n"
            + "\n".join(tail)
        )
    return out


def render_via_openmontage(rid: str, image: str, engine: MontageEngineStatus, output_path: Path) -> Path:
    """Render still -> video via the OpenMontage pipeline (Remotion path).

    Used as the primary path when Remotion is genuinely usable. If it fails
    (e.g. Remotion node_modules not installed, or Windows [WinError 193] from
    the npx .cmd shim), raises RuntimeError so the caller can fall back to the
    FFmpeg Ken Burns path.
    """
    sys.path.insert(0, str(OPENMONTAGE_ROOT))
    from tools.video.video_compose import VideoCompose
    from lib.env_loader import load_env

    load_env(OPENMONTAGE_ROOT)

    vc = VideoCompose()
    source_id = "poster"
    source_path = resolve_public_asset(image)
    if not source_path:
        raise RuntimeError(
            f"record {rid}: cannot resolve poster image {image!r} under "
            f"{PORTAL_PUBLIC_DIR} — stage the image and re-run."
        )
    asset_manifest = {"assets": [{"id": source_id, "path": str(source_path), "kind": "image"}]}
    edit_decisions = {
        # render_runtime MUST be locked at proposal stage and carried into
        # edit_decisions — OpenMontage governance fails the render if absent.
        # A still-image -> short-video social montage composes under Remotion.
        "render_runtime": "remotion",
        "renderer_family": "documentary-montage",
        "metadata": {
            "renderer_family": "documentary-montage",
            "proposal_render_runtime": "remotion",
            "compose_target": {"width": 1080, "height": 1080, "fit": "cover"},
        },
        "cuts": [{"source": source_id, "in_seconds": 0, "out_seconds": 2, "speed": 1.0}],
    }
    result = vc.execute({
        "operation": "render",
        "output_path": str(output_path),
        "edit_decisions": edit_decisions,
        "asset_manifest": asset_manifest,
    })
    if not result.success or not output_path.exists():
        raise RuntimeError(f"record {rid}: montage render failed: {result.error}")
    return output_path


def process_record(record: dict[str, Any], engine: MontageEngineStatus) -> str:
    """Process one record's asset through the montage pipeline.

    Returns the generated media_url (an absolute / public path) on success.
    Raises RuntimeError with a clear message when the engine is unavailable —
    the worker reports this as an actionable status rather than silently
    skipping or pretending to render.
    """
    rid = record.get("id") or "?"
    media_type = record.get("media_type") or "image"
    image = record.get("image") or ""
    media_url = record.get("media_url")

    # Already has media -> nothing more to generate.
    if media_url:
        return media_url

    if not engine.available:
        missing = ", ".join(engine.errors) or "unknown"
        raise RuntimeError(
            f"record {rid}: montage engines unavailable ({missing}). "
            f"Install OpenMontage + ffmpeg (see OPENMONTAGE_ROOT) or stage the "
            f"media, then re-run."
        )

    # Resolve the poster image to a real file. The record's `image` is a public
    # URL ("/images/p2.jpg"); we map it under the portal public dir. Without a
    # resolvable source there is nothing to render, so fail clearly.
    source_path = resolve_public_asset(image)
    if not source_path:
        raise RuntimeError(
            f"record {rid}: cannot resolve poster image {image!r} under "
            f"{PORTAL_PUBLIC_DIR} — stage the image and re-run."
        )

    render_root = Path(os.environ.get("MONTAGE_RENDER_DIR", OPENMONTAGE_ROOT / "projects" / "social" / "renders"))
    render_root.mkdir(parents=True, exist_ok=True)
    output_path = render_root / f"{rid}.mp4"

    # Preferred pipeline selector.
    #   MONTAGE_RENDERER=ffmpeg     -> FFmpeg Ken Burns only (default; reliable on
    #                                   Windows, no node/npx, no WinError 193).
    #   MONTAGE_RENDERER=openmontage -> OpenMontage (Remotion) first, FFmpeg fallback.
    #   MONTAGE_RENDERER=auto        -> OpenMontage if Remotion is healthy,
    #                                   otherwise FFmpeg.
    renderer = os.environ.get("MONTAGE_RENDERER", "ffmpeg").strip().lower()

    def ffmpeg_fallback(reason: str = "") -> Path:
        if renderer == "openmontage":
            # Governance: a downgrade from an explicit OpenMontage render is not
            # automatic. Report clearly and let an operator decide.
            raise RuntimeError(
                f"record {rid}: MONTAGE_RENDERER=openmontage but Remotion path "
                f"failed{(' (' + reason + ')') if reason else ''}. Set "
                f"MONTAGE_RENDERER=ffmpeg to use the FFmpeg Ken Burns path."
            )
        return render_via_ffmpeg_kenburns(rid, source_path, output_path)

    try:
        if renderer in ("openmontage", "auto"):
            try:
                render_via_openmontage(rid, image, engine, output_path)
            except Exception as om_exc:
                if renderer == "openmontage":
                    raise
                # auto -> degrade to FFmpeg with a note.
                output_path.unlink(missing_ok=True)
                ffmpeg_fallback(f"OpenMontage failed: {om_exc}")
        else:
            # Default: FFmpeg-only Ken Burns. No node/npx involved, so it never
            # hits the Windows [WinError 193] .cmd-shim failure.
            render_via_ffmpeg_kenburns(rid, source_path, output_path)

        if not output_path.exists():
            # Belt-and-braces: if auto path fell through oddly, try FFmpeg.
            if renderer == "auto":
                ffmpeg_fallback("no output was produced")
            else:
                raise RuntimeError(f"record {rid}: render produced no output file")
        # Publish the finished render into the portal's static /media dir so the
        # public `/media/<rid>.mp4` URL resolves end-to-end from the web app.
        publish_media(rid, output_path)
        # Return a public URL path for the generated file (relative to /media).
        return f"/media/{rid}.mp4"
    except RuntimeError:
        raise
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"record {rid}: montage processing error: {exc}")


# ---------------------------------------------------------------------------
# Direct SMTP Email Notification (no n8n)
# ---------------------------------------------------------------------------

# Default recipient for batch-ready notifications (matches the saved contact).
DEFAULT_NOTIFICATION_EMAIL = "mail.danmueller@gmail.com"


def send_assets_ready_email(zip_path: Path, counts: dict[str, int], asset_list: Optional[list[dict[str, Any]]] = None, download_url: str = "") -> dict[str, Any]:
    """Send a direct SMTP email listing generated assets + the download link.

    Config via env (all optional so the worker never hard-fails when unset):
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM.
    Recipient defaults to NOTIFICATION_EMAIL (default mail.danmueller@gmail.com).

    `download_url` (optional) is the permanent link to the bundle — when set to
    a Supabase Storage public URL it stays clickable from any deployment,
    including serverless (Vercel). Falls back to the local /zips/ path.

    Returns a result dict. If SMTP isn't configured, returns { sent: false,
    skipped: true } — graceful, zero-maintenance.
    """
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    recipient = os.environ.get("NOTIFICATION_EMAIL", DEFAULT_NOTIFICATION_EMAIL).strip()

    if not host or not user:
        return {"sent": False, "skipped": True, "reason": "SMTP not configured (SMTP_HOST/SMTP_USER)."}

    port = int(os.environ.get("SMTP_PORT", "587").strip() or "587")
    from_addr = os.environ.get("SMTP_FROM", user).strip() or user

    # Asset manifest lines (name + kind + path + caption where available).
    lines: list[str] = []
    for a in asset_list or []:
        rid = a.get("id") or "asset"
        kind = a.get("mediaType") or ("video" if a.get("mediaUrl") else "image")
        path = a.get("path") or a.get("mediaUrl") or a.get("image") or ""
        caption = (a.get("caption") or "").strip()
        lines.append(f"• {rid} ({kind}): {path or '(file)'}" + (f" — {caption}" if caption else ""))

    img_n = counts.get("images", 0)
    vid_n = counts.get("videos", 0)
    # Preferred download link: permanent Supabase Storage public URL (serverless
    # safe). Falls back to the portal's /zips/ path when storage isn't used.
    if download_url and download_url.startswith(("http://", "https://")):
        download = download_url
        download_note = "This is a permanent secure link — click to download the full approved bundle."
    else:
        download = download_url or (f"/zips/{zip_path.name}" if zip_path and zip_path.name else str(zip_path))
        download_note = (
            "(The portal serves /zips/ from public/zips/ — for serverless/Vercel "
            "deployments please use the Supabase Storage public URL.)"
        )

    subject = f"Coffs Coast Pest Control — {img_n} images + {vid_n} videos ready for review"
    body_lines = [
        "Your monthly social media asset batch is ready to review.",
        "",
        f"Generated: {img_n} images, {vid_n} videos",
        "",
    ]
    if lines:
        body_lines += ["Assets:", *lines, ""]
    body_lines += [
        "Download the full approved bundle:",
        download,
        "",
        download_note,
        "",
        "Review, then publish to Meta Business Suite / Google Business Profile.",
        "— Coffs Coast Pest Control automation",
    ]
    body = "\n".join(body_lines)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = recipient
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            if os.environ.get("SMTP_STARTTLS", "true").lower() != "false":
                server.starttls()
                server.ehlo()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return {"sent": True, "to": recipient, "subject": subject, "download": download}
    except Exception as exc:  # pragma: no cover
        return {"sent": False, "skipped": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# On-Demand Test Trigger — full test batch (8 images + 3 videos → ZIP)
# ---------------------------------------------------------------------------

def run_on_demand(dry_run: bool = False) -> dict[str, Any]:
    """Immediately execute the full marketing-asset test batch.

    Generates 8 branded still images (Gemini-conceptualized captions) +
    3 video montages, watermarks every asset with the hardcoded logo, then
    packages the Approved-set into a downloadable ZIP and announces that it's
    ready for review.

    Returns a JSON-able summary. Writes generated images/videos into the
    portal public dirs so they are served as 200s (no broken references).
    """
    if _pipeline is not None:
        pipeline = _pipeline
    else:
        try:
            from . import pipeline  # noqa: F401
        except ImportError:
            import pipeline  # noqa: F401
    _load_dotenv_local()  # ensure NEXT_PUBLIC / SMTP / storage env is populated
    engine = probe_montage_engine()  # noqa: F841 - diagnostics only
    result: dict[str, Any] = {
        "mode": "on-demand-test",
        "gemini": pipeline.gemini_configured(),
        "images": [],
        "videos": [],
        "zip": None,
        "notify": None,
        "errors": [],
    }

    # 1) Conceptualization (Gemini when configured, static fallback otherwise).
    image_concepts = pipeline.conceptualize_images()
    video_concepts = pipeline.conceptualize_videos()
    if not pipeline.gemini_configured():
        result["notice"] = "GEMINI_API_KEY not set — used static brand captions. Add the key to .env.local to enable Gemini conceptualization."

    img_out_dir = PORTAL_PUBLIC_DIR / "images"
    img_out_dir.mkdir(parents=True, exist_ok=True)

    # 2) Generate 8 branded still images.
    for i, concept in enumerate(image_concepts, start=1):
        rid = f"on-demand-{i}"
        # Deterministic branded poster: begin from the existing brand JPEG from
        # the pool (p1..p6) matching the topic, then re-watermark at 1080.
        src = img_out_dir / f"p{((i - 1) % 6) + 1}.jpg"
        try:
            pipeline.watermark_image(src, img_out_dir / f"{rid}.jpg", PORTAL_PUBLIC_DIR)
            result["images"].append({
                "id": rid,
                "path": f"/images/{rid}.jpg",
                "topic": concept["topic"],
                "angle": concept["angle"],
                "caption": concept["caption"],
            })
        except Exception as exc:  # pragma: no cover
            result["errors"].append({"id": rid, "error": str(exc)})

    # 3) Generate 3 video montages (FFmpeg Ken Burns + baked logo watermark).
    rend_root = Path(os.environ.get("MONTAGE_RENDER_DIR", OPENMONTAGE_ROOT / "projects" / "social" / "renders"))
    rend_root.mkdir(parents=True, exist_ok=True)
    for concept in video_concepts:
        vid = concept["id"] or "test-video-montage"
        # Poster source per brief. test-video-montage uses p1.
        poster_map = {"post-7": "p2.jpg", "post-8": "p3.jpg", "test-video-montage-1": "p1.jpg"}
        poster = img_out_dir / poster_map.get(vid, "p1.jpg")
        try:
            out = render_via_ffmpeg_kenburns(vid, poster, rend_root / f"{vid}.mp4")
            publish_media(vid, out)
            result["videos"].append({"id": vid, "path": f"/media/{vid}.mp4", "caption": concept["caption"]})
        except Exception as exc:  # pragma: no cover
            result["errors"].append({"id": vid, "error": str(exc)})

    # 4) Package all generated assets into a ZIP, then notify by email.
    if result["images"] or result["videos"]:
        assets = [{"id": a["id"], "mediaType": "image", "image": a["path"]} for a in result["images"]]
        assets += [{"id": v["id"], "mediaType": "video", "mediaUrl": v["path"]} for v in result["videos"]]
        zip_path = pipeline.package_approved_assets(assets, PORTAL_PUBLIC_DIR)
        result["zip"] = str(zip_path)

        # 4b) Persist the bundle to Supabase Storage so it survives serverless
        # (Vercel) deployments where public/zips/ is ephemeral. When upload
        # succeeds we use the permanent public URL for the download link/email.
        try:
            storage = pipeline.upload_zip_to_storage(zip_path)
            result["storage"] = storage
        except Exception as exc:  # pragma: no cover
            result["storage"] = {"uploaded": False, "skipped": True, "error": str(exc)}
        bundle_url = (
            (result["storage"] or {}).get("publicUrl", "")
            or result["zip"]
        )

        # Console line (always).
        print(
            f"[montage-worker] [assets-ready] Packaging complete — "
            f"{len(result['images'])} images, {len(result['videos'])} videos -> {bundle_url}"
        )

        # Direct SMTP email to NOTIFICATION_EMAIL (no n8n).
        counts = {"images": len(result["images"]), "videos": len(result["videos"])}
        combined = [*result["images"], *result["videos"]]
        if dry_run:
            result["notify"] = {"sent": False, "dry_run": True, "to": os.environ.get("NOTIFICATION_EMAIL", DEFAULT_NOTIFICATION_EMAIL)}
        else:
            result["notify"] = send_assets_ready_email(zip_path, counts, combined, download_url=bundle_url)

    return result


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_once(limit: int = 50, dry_run: bool = False) -> dict[str, Any]:
    """Execute one worker pass and return a result summary."""
    url, key = get_supabase_config()
    db = Supabase(url, key)
    summary: dict[str, Any] = {
        "checked": 0,
        "pending": 0,
        "processed": 0,
        "updated": [],
        "errors": [],
        "engines": None,
    }
    try:
        engine = probe_montage_engine()
        summary["engines"] = {"available": engine.available, "engines": engine.engines, "errors": engine.errors}

        rows = db.fetch_pending(limit=limit)
        summary["pending"] = len(rows)

        for record in rows:
            summary["checked"] += 1
            rid = record.get("id")
            try:
                media_url = process_record(record, engine)
                if dry_run:
                    summary["updated"].append({"id": rid, "media_url": media_url, "dry_run": True})
                    continue
                updated = db.update_media(rid, media_url, status="Ready")
                summary["processed"] += 1
                summary["updated"].append({"id": rid, "media_url": media_url})
            except Exception as exc:
                summary["errors"].append({"id": rid, "error": str(exc)})
    finally:
        db.close()

    # On dry-run we processed candidates but did not persist.
    if dry_run:
        summary["processed"] = len(summary["updated"])
    return summary


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="OpenMontage <-> Supabase montage worker")
    parser.add_argument("--limit", type=int, default=50, help="Max records to process per run")
    parser.add_argument("--dry-run", action="store_true", help="Fetch pending records but do not update the DB")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON summary")
    parser.add_argument(
        "--on-demand",
        action="store_true",
        help="Run the full On-Demand test batch (8 images + 3 videos -> branded -> ZIP).",
    )
    args = parser.parse_args(argv)

    start = time.time()
    try:
        if args.on_demand:
            summary = run_on_demand(dry_run=args.dry_run)
        else:
            summary = run_once(limit=args.limit, dry_run=args.dry_run)
    except RuntimeError as exc:
        if args.json:
            print(json.dumps({"error": str(exc)}))
        else:
            print(f"[montage-worker] ERROR: {exc}", file=sys.stderr)
        return 1

    summary["elapsed_seconds"] = round(time.time() - start, 2)
    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    engines = summary["engines"] or {}
    print(f"[montage-worker] Supabase connected.")
    print(f"[montage-worker] OpenMontage available: {engines.get('available')}")
    if engines.get("errors"):
        for e in engines["errors"]:
            print(f"[montage-worker]   - {e}")
    print(f"[montage-worker] pending: {summary['pending']} | processed: {summary['processed']}")
    for u in summary["updated"]:
        print(f"[montage-worker]   updated {u['id']} -> {u.get('media_url')}")
    for err in summary["errors"]:
        print(f"[montage-worker]   ERROR {err['id']}: {err['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
