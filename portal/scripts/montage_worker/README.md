# Montage Worker — Supabase ⇄ OpenMontage bridge

Server-side media-processing worker for the Coffs Coast Pest Control social
approval portal. It connects to the Supabase backend, picks up records that are
queued for video/montage generation, runs them through the **OpenMontage**
pipeline to produce the final media file, then writes the generated `media_url`
back to `public.social_posts` and advances the record's status.

## What it does

1. **Connect** — reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (from the portal's `.env.local` or the environment) and talks to the
   `public.social_posts` table over the PostgREST API. No extra SDK needed —
   the same public key the Next.js portal uses server-side.
2. **Fetch pending records** — selects records that are actual montage jobs:
   - `media_type = 'video'` with no `media_url` yet, **or**
   - `uploaded = true` job-site assets awaiting a montage piece.
   Casual Draft image posts (stock reference seed rows) are *not* picked up.
3. **Process assets** — invokes the OpenMontage tooling (from
   `OPENMONTAGE_ROOT`, defaulting to the vendored `.tmp/OpenMontage`) to render
   the final media file. If OpenMontage's render engines (ffmpeg / Remotion /
   HyperFrames) are unavailable, the worker reports an explicit, actionable
   status instead of silently pretending to render.
4. **Update the database** — writes the generated `media_url` and sets
   `status = 'Ready'` on the processed record.

## Requirements

- Python 3.10+ (OpenMontage requires 3.10+).
- `httpx` (`pip install httpx`).
- **OpenMontage checkout** at `OPENMONTAGE_ROOT` (default:
  `.tmp/OpenMontage` mirror) with a working render engine.
- **A render engine** (at least one of):
  - **FFmpeg** — `ffmpeg` on PATH (fastest path for video montage).
  - **Remotion** — `cd remotion-composer && npm install`.
  - **HyperFrames** — Node 22 + `npx hyperframes`.

Without a render engine the worker still connects, checks pending records, and
reports the missing piece — so it degrades gracefully (zero-maintenance).

## Running

```bash
cd portal
py -3 scripts/montage_worker/worker.py --dry-run   # check connectivity + pending, no writes
py -3 scripts/montage_worker/worker.py             # process + update the DB
py -3 scripts/montage_worker/worker.py --json      # machine-readable summary
```

Options:

| Flag | Meaning |
|------|---------|
| `--limit N` | Max records to process per run (default 50) |
| `--dry-run` | Fetch + report pending records, but do **not** update the DB |
| `--json` | Print a parseable JSON summary |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (reads `.env.local` automatically) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public publishable/anon key (reads `.env.local`) |
| `OPENMONTAGE_ROOT` | Optional override for the OpenMontage checkout path |
| `SOCIAL_POSTS_TABLE` | Default `social_posts`; override if the table is renamed |
| `MONTAGE_RENDER_DIR` | Where rendered media files land (default: under `projects/social/renders/`) |
| `PORTAL_ENV_FILE` | Optional explicit path to the `.env.local` to load |

## Notes

- **Human-in-the-loop:** OpenMontage is an agent-driven system with human
  approval gates. This worker only auto-drives the *deterministic* tool surface
  (`video_compose`) for bulk media generation; any creative/gate decisions stay
  manual. Deployments / scheduled runs should be reviewed and approved before
  going live.
- **License:** OpenMontage is **AGPLv3**. Confirm your deployment's compliance
  (server-side use of AGPL code generally requires offering source) before
  shipping this integration to production.
- **Reachability of rendered files:** the worker returns an internal path like
  `/media/<id>.mp4`; wire it to wherever the portal serves video from (e.g. a
  public/media dir or an object store) so the `<video>` players can resolve it.
