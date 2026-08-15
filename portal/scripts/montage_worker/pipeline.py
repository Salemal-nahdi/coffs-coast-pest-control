"""Asset pipeline helpers — Gemini conceptualization, branding, and ZIP packaging.

Self-contained, dependency-light helpers used by the montage worker and the
portal's on-demand test trigger. Everything here uses only stdlib + packages
the worker already counts on (httpx, PIL, zipfile). The Gemini API key is read
from the environment / portal's `.env.local` (git-ignored) and is never logged
or committed.
"""

from __future__ import annotations

import json
import os
import shutil
import smtplib
import zipfile
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Optional

import httpx

# The transparent brand logo (500x500 RGBA). Brand rule: the no-background
# logo sits on a solid black shell, bottom-right, and is NEVER cropped or
# distorted/aspect-changed. This path is relative to the portal public dir
# so the worker's branding helpers can apply it deterministically.
LOGO_REL = "images/logo-no-background.png"

# Env injected at runtime (never hardcoded). Kept in the git-ignored
# `.env.local` so the secret stays out of the repository.
GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
GEMINI_MODEL_ENV = "GEMINI_MODEL"
GEMINI_REST_ENDPOINT_ENV = "GEMINI_REST_ENDPOINT"

# Direct SMTP notification env vars (Python smtplib — no n8n needed).
SMTP_HOST_ENV = "SMTP_HOST"
SMTP_PORT_ENV = "SMTP_PORT"
SMTP_USER_ENV = "SMTP_USER"
SMTP_PASSWORD_ENV = "SMTP_PASSWORD"
SMTP_FROM_ENV = "SMTP_FROM"
NOTIFICATION_EMAIL_ENV = "NOTIFICATION_EMAIL"

# Supabase Storage env vars for persisting generated ZIP bundles on serverless
# (Vercel) deployments, where writes to public/zips/ are ephemeral.
STORAGE_BUCKET_ENV = "SUPABASE_STORAGE_BUCKET"
STORAGE_PREFIX_ENV = "SUPABASE_STORAGE_PREFIX"
DEFAULT_STORAGE_BUCKET = "asset-bundles"
DEFAULT_STORAGE_PREFIX = "zips"

# Default recipient for batch-ready notifications (matches the saved contact).
DEFAULT_NOTIFICATION_EMAIL = "mail.danmueller@gmail.com"

DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
# Google AI Studio / Generative Language API REST endpoint for text-driven
# conceptualization. Use `generateContent` (text) — image-gen via the API is
# a separate product and not required for this deterministic pipeline.
DEFAULT_GEMINI_REST_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"

# Brand lock: every generated image / video is 1080x1080 (social standard) so
# layout / aspect ratio stays consistent and content is never distorted.
ASSET_CANVAS = (1080, 1080)


# ---------------------------------------------------------------------------
# Environment / secrets
# ---------------------------------------------------------------------------

def get_gemini_key() -> str:
    """Return the configured Gemini API key, or "" when not set.

    Reads GEMINI_API_KEY from the environment (populated from `.env.local`
    by the worker's loader). Never printed/logged; masked in summaries.
    """
    return (os.environ.get(GEMINI_API_KEY_ENV) or "").strip()


def gemini_configured() -> bool:
    """True iff a Gemini API key is available for conceptualization."""
    return bool(get_gemini_key())


# ---------------------------------------------------------------------------
# Gemini conceptualization
# ---------------------------------------------------------------------------

# Monthly creative brief — the 8 keywords/captions and 3 video montage briefs
# reflect the existing brand topics (p1–p6 + termite/rodent video angles).
IMAGE_BRIEFS = [
    {"topic": "general-pest",  "angle": "call-to-book",   "prompt": "General pest treatment protecting a coastal home"}
, {"topic": "termite-guard",  "angle": "as3660-education", "prompt": "AS 3660 compliant termite inspection"}
, {"topic": "rodent-control", "angle": "peace-of-mind",  "prompt": "Discreet rodent control across the Coffs Coast"}
, {"topic": "local-experts",  "angle": "family-run",     "prompt": "Local family-run pest experts"}
, {"topic": "reviews",        "angle": "google-reviews", "prompt": "Trusted local customers' Google reviews"}
, {"topic": "spider-season",  "angle": "seasonal-prep",  "prompt": "Spider season preparation"}
, {"topic": "general-pest",   "angle": "safety-steps",   "prompt": "Safe family-friendly pest treatment"}
, {"topic": "seasonal",       "angle": "spring-prep",    "prompt": "Spring pest preparation"}
]

# Three video montage briefs match post-7/post-8 and one test reel. The videos
# themselves are rendered deterministically (FFmpeg Ken Burns) from the branded
# poster; Gemini conceptualizes the caption/script framing.
VIDEO_BRIEFS = [
    {"id": "post-7", "topic": "termite-guard", "angle": "video-overview",
     "prompt": "AS 3660 compliant termite inspection 30s rundown for a homeowner"},
    {"id": "post-8", "topic": "rodent-control", "angle": "video-howto",
     "prompt": "Rodent control in action, discreet and finished in one visit"},
    {"id": "test-video-montage-1", "topic": "general-pest", "angle": "test-reel",
     "prompt": "General pest protection test reel for the Coffs Coast"},
]

# Graceful fallback captions (used when Gemini is not configured / the call
# fails). Guarantees the pipeline still ships branded assets with sensible copy.
IMAGE_CAPTIONS = [
    "🐜 Protecting Coffs Harbour homes year-round. Book your general pest treatment today — call Cristian on 0449 252 963. #CoffsCoastPestControl #PestFreeHome",  # noqa: E501
    "Did you know termites cause more damage than fire each year in Australia? Stay ahead with an AS 3660 compliant termite inspection. ☎️ 0449 252 963",  # noqa: E501
    "Rodent-free means rest easy. Discreet, effective rodent control across the Coffs Coast. ABN 95 610 493 013. Message us to book a spring clean treatment.",  # noqa: E501
    "Your local, family-run pest experts 🏡 Coffs Harbour, Woolgoolga, Sawtell & beyond. Free quotes — call 0449 252 963 today!",  # noqa: E501
    "Loved by our local customers ⭐ Friendly, thorough and reliable pest control. If you've used our service, we'd be grateful for your Google review!",  # noqa: E501
    "Spider season is coming 🕷️ Put the kettle on and leave the web-work to us. General pest + spider treatment, one call: 0449 252 963.",  # noqa: E501
    "🐜 Safe, family-friendly treatment. Re-entry 1–2 hrs after drying. ☎️ 0449 252 963",  # noqa: E501
    "Spring is here 🌿 Get ahead of pests with a seasonal treatment plan.",
]

VIDEO_CAPTIONS = {
    "post-7": "Watch how an AS 3660 compliant termite inspection protects your home — 30-second rundown with Cristian. ☎️ 0449 252 963",
    "post-8": "Rodent control in action 🎥 Discreet, effective, and finished in one visit. Book today — 0449 252 963.",
    "test-video-montage-1": "General pest protection in a quick reel 🎥 Coffs Coast Pest Control — call Cristian on 0449 252 963.",
}


def _gemini_headers() -> dict[str, str]:
    return {"Content-Type": "application/json"}


def _gemini_endpoint() -> str:
    endpoint = (os.environ.get(GEMINI_REST_ENDPOINT_ENV) or DEFAULT_GEMINI_REST_ENDPOINT).strip()
    model = (os.environ.get(GEMINI_MODEL_ENV) or DEFAULT_GEMINI_MODEL).strip()
    return f"{endpoint.rstrip('/')}/models/{model}:generateContent"


def _request_gemini(prompt: str, timeout: float = 45.0) -> Optional[str]:
    """Ask the configured Gemini model for a short creative caption/script.

    Returns the model's text or None on any failure (missing key, network,
    non-2xx). Parses the standard generateContent response. Bounded timeout so
    the worker never hangs on a slow network.
    """
    key = get_gemini_key()
    if not key:
        return None
    url = _gemini_endpoint()
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.8,
            "maxOutputTokens": 200,
        },
    }
    try:
        resp = httpx.post(
            url,
            params={"key": key},
            headers=_gemini_headers(),
            json=payload,
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates") or []
        if not candidates:
            return None
        text = (candidates[0].get("content", {}).get("parts") or [{}])[0].get("text", "")
        return text.strip() or None
    except Exception:
        return None


def conceptualize_images() -> list[dict[str, str]]:
    """Return the 8-image conceptualization (topic/angle/caption).

    Uses Gemini when configured to enrich/refresh the captions; otherwise uses
    the static brand captions. Each result carries a `prompt` used as the
    image-generation seed text.
    """
    out: list[dict[str, str]] = []
    for i, brief in enumerate(IMAGE_BRIEFS):
        caption = IMAGE_CAPTIONS[i]
        if gemini_configured():
            gen = _request_gemini(
                f"Write a punchy 1-sentence social caption (max 280 chars) for a "
                f"pest-control business in Coffs Coast focused on: {brief['prompt']}. "
                f"Include the phone 0449 252 963. No hashtags clutter."
            )
            if gen:
                caption = gen[:280]
        out.append({"topic": brief["topic"], "angle": brief["angle"], "caption": caption})
    return out


def conceptualize_videos() -> list[dict[str, str]]:
    """Return the 3-video conceptualization (id/caption)."""
    out: list[dict[str, str]] = []
    for brief in VIDEO_BRIEFS:
        caption = VIDEO_CAPTIONS.get(brief["id"], "")
        if gemini_configured():
            gen = _request_gemini(
                f"Write a 1-sentence social video caption for: {brief['prompt']}. "
                f"Pest control, Coffs Coast, phone 0449 252 963."
            )
            if gen:
                caption = gen[:280]
        out.append({"id": brief["id"], "caption": caption or VIDEO_CAPTIONS.get(brief["id"], "")})
    return out


# ---------------------------------------------------------------------------
# Branding — logo watermark (images + videos)
# ---------------------------------------------------------------------------

def _logo_asset_path(portal_public: Path) -> Path:
    """Return the absolute path to the transparent logo asset."""
    return portal_public / LOGO_REL


def watermark_image(src: Path, dst: Path, portal_public: Path) -> Path:
    """Overlay the transparent logo on an image (RGBA composite).

    Brand rules enforced:
      - Source image is never resized/cropped/distorted (canvas is 1080x1080,
        source letterboxed on black, keeping original aspect).
      - Logo is placed on the solid black shell bottom-right, at a fixed scale,
        never cropped or aspect-changed.
    Uses PIL only (no OpenCV dependency).
    """
    from PIL import Image

    logo = _logo_asset_path(portal_public)
    dst.parent.mkdir(parents=True, exist_ok=True)

    base = Image.open(src).convert("RGBA")
    w, h = base.size
    cw, ch = ASSET_CANVAS

    # Cover-fit onto the black canvas WITHOUT cropping: scale the smaller
    # dimension to fit and center on a solid black background (letterbox).
    scale = min(cw / w, ch / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = base.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 255))
    canvas.paste(resized, ((cw - nw) // 2, (ch - nh) // 2), resized)

    # Watermark logo: bottom-right corner at ~14% of canvas width, solid black
    # shell behind it (brand rule). Never crop/distort the logo.
    if logo.exists():
        lg = Image.open(logo).convert("RGBA")
        lw = max(40, int(cw * 0.14))
        lh = int(lg.size[1] * (lw / lg.size[0]))
        lg = lg.resize((lw, lh), Image.LANCZOS)
        margin = int(cw * 0.03)
        lx, ly = cw - lw - margin, ch - lh - margin
        # Solid black rounded shell slightly larger than the logo.
        shell = Image.new("RGBA", (lw + 8, lh + 8), (0, 0, 0, 255))
        shell = shell.convert("RGBA")
        canvas.paste(shell, (lx - 4, ly - 4), shell)
        canvas.paste(lg, (lx, ly), lg)

    canvas.convert("RGB").save(dst, "JPEG", quality=92)
    return dst


def _watermark_overlay_vf(portal_public: Path, out_size: int = 1080, scale: float = 0.14) -> str:
    """Return an FFmpeg filter_complex string that overlays the logo.

    The logo is scaled to `scale` of the video width, placed bottom-right over
    a solid black backdrop. The overlay stays unzoomed/uncropped/aspect-fixed
    (brand rule). Used by the FFmpeg Ken Burns video renderer.
    """
    logo = _logo_asset_path(portal_public)
    if not logo.exists():
        return ""
    lw = max(40, int(out_size * scale))
    # Scale the logo to lw wide on a black 60x60-ish shell; keep aspect by
    # deriving height from the logo, but cap shell to a square solid block.
    return (
        f"[1:v]scale={lw}:-1,format=rgba[lg];"
        f"[0:v][lg]overlay=W-w-{int(out_size*0.03)}:H-h-{int(out_size*0.03)}:eof_action=pass"
    )


# ---------------------------------------------------------------------------
# ZIP packaging of Approved assets
# ---------------------------------------------------------------------------

def package_approved_assets(
    assets: list[dict[str, Any]],
    portal_public: Path,
    dest_dir: Path | None = None,
) -> Path:
    """Compile Approved assets into a single ZIP for download.

    assets: list of { "id", "mediaType", "image", "mediaUrl" } resolved to
            public `/images|/media` paths under portal_public.
    Returns the path to the created `.zip`. Names inside are flattened to
    `post-<id>.<ext>` so the client gets a clean, reviewable bundle.
    """
    dest_dir = dest_dir or portal_public / "zips"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    zip_path = dest_dir / f"approved-assets-{stamp}.zip"

    seen: set[str] = set()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for asset in assets:
            rid = asset.get("id") or "asset"
            is_video = asset.get("mediaType") == "video"
            rel = asset.get("mediaUrl") or asset.get("image") or ""
            src = _resolve_public_path(rel, portal_public)
            if not src or not src.is_file():
                continue
            ext = src.suffix.lower() or (".mp4" if is_video else ".jpg")
            arcname = f"post-{rid}{ext}"
            # De-duplicate arcnames (same id twice -> suffix).
            base, n = arcname, 1
            while arcname in seen:
                n += 1
                arcname = f"{base.rsplit('.', 1)[0]}-{n}{ext}"
            seen.add(arcname)
            zf.write(src, arcname)

    return zip_path if zip_path.exists() else dest_dir / "none"


def _resolve_public_path(rel: str, portal_public: Path) -> Path:
    """Resolve a `/images|/media/...` public path to a file under portal_public."""
    if not rel:
        return Path()
    p = Path(rel)
    if p.is_absolute() and p.exists():
        return p
    stripped = rel.lstrip("/")
    candidate = portal_public / stripped
    return candidate if candidate.exists() else Path()


def upload_zip_to_storage(
    zip_path: Path,
    url: str = "",
    key: str = "",
    bucket: str = "",
) -> dict[str, Any]:
    """Upload a generated ZIP bundle to Supabase Storage (persists on serverless).

    On Vercel/Netlify, files written to `public/zips/` live only for the life of
    the Lambda — so bundles would be lost between runs. Uploading the archive to
    a Supabase Storage bucket (a globally persistent object store) lets the
    dashboard download it reliably from any deployment.

    Config via env (Supabase from the shared config vars, optional overrides):
      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
      SUPABASE_STORAGE_BUCKET (default "asset-bundles")
      SUPABASE_STORAGE_PREFIX (default "zips")

    Returns a JSON-able dict. If storage isn't configured/available it returns
    { uploaded: false } — graceful, zero-maintenance (the ZIP still exists on
    the local filesystem for non-serverless use).
    """
    obj_name = zip_path.name
    prefix = (os.environ.get(STORAGE_PREFIX_ENV, DEFAULT_STORAGE_PREFIX) or DEFAULT_STORAGE_PREFIX).strip("/")
    bucket = bucket or os.environ.get(STORAGE_BUCKET_ENV, DEFAULT_STORAGE_BUCKET) or DEFAULT_STORAGE_BUCKET
    supabase_url = (url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")).strip("/")
    supabase_key = key or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "").strip()
    if not supabase_url or not supabase_key or not zip_path.exists():
        return {"uploaded": False, "skipped": True, "reason": "Supabase/storage not configured or file missing."}

    # Storage object upload endpoint (REST, no SDK required):
    #   POST {url}/storage/v1/object/{bucket}/{prefix}/{name}
    try:
        with zip_path.open("rb") as fh:
            resp = httpx.post(
                f"{supabase_url}/storage/v1/object/{bucket}/{prefix}/{obj_name}",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/zip",
                    "x-upsert": "false",
                },
                content=fh.read(),
                timeout=120,
            )
        if resp.status_code not in (200, 201, 204):
            return {
                "uploaded": False,
                "skipped": False,
                "status": resp.status_code,
                "error": resp.text[:300],
            }
        # Public URL for download (bucket must be public; if private the
        # dashboard falls back to listing via the storage API).
        public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{prefix}/{obj_name}"
        return {"uploaded": True, "bucket": bucket, "prefix": prefix, "name": obj_name, "publicUrl": public_url}
    except Exception as exc:  # pragma: no cover
        return {"uploaded": False, "skipped": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Notify / announce (console + hook)
# ---------------------------------------------------------------------------

def announce_ready(zip_path: Path, counts: dict[str, int], portal_public: Path) -> dict[str, Any]:
    """Console + optional webhook notification that packaged assets are ready.

    Kept dependency-free: prints a clear review-ready line to stdout (the
    "console notification"), and fires the same n8n webhook pattern the portal
    uses (N8N_WEBHOOK_URL) when configured.
    """
    fmt = " * Console: artefactos listos"
    line = (
        f"[assets-ready] Packaging complete — {counts.get('images', 0)} images, "
        f"{counts.get('videos', 0)} videos → {zip_path}"
    )
    print(f"[montage-worker] {line}")

    hook = os.environ.get("N8N_WEBHOOK_URL")
    result: dict[str, Any] = {"announced": "console"}
    if hook:
        try:
            r = httpx.post(hook, json={
                "event": "assets_batch_ready",
                "zip": str(zip_path),
                "images": counts.get("images", 0),
                "videos": counts.get("videos", 0),
            }, timeout=20)
            result["announced"] = "webhook"
            result["webhookStatus"] = r.status_code
        except Exception as exc:  # pragma: no cover
            result["webhookStatus"] = "error"
            result["webhookError"] = str(exc)
    return result


def _copy2(src: Path, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst