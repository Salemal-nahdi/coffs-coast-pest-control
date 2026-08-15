# Coffs Coast Pest Control — Client Social Media Approval Portal

A minimal, rock-solid **Next.js** portal that lets the client review their
scheduled social media content calendar, **edit captions inline**, and
**approve posts** — syncing everything to **Supabase** and deploying to
**Vercel** on the free tier.

![Stack](https://img.shields.io/badge/Next.js-14-black) ![Stack](https://img.shields.io/badge/Supabase-green) ![Stack](https://img.shields.io/badge/Vercel-free-black)

---

## ✨ Features

- **Calendar dashboard** — scheduled content grid with **image previews**
  drawn from the original brand JPEGs (aspect ratio fully preserved).
- **Inline editing** — clients edit captions directly in the browser and save
  with one click.
- **Approve workflow** — an *Approve* button marks a post as
  `Approved`, flags it `flagged_for_review`, and stamps `approved_at`.
- **Password protection** — secure, unlisted route wrapper gated by a
  `PORTAL_PASSWORD` environment variable (constant-time check, httpOnly cookie).
- **Graceful demo mode** — if Supabase isn't configured yet, the portal still
  renders with built-in demo content so nothing ever breaks.
- **Zero-distortion branding** — the transparent logo always renders inside a
  **solid black shell** so it pops. Montserrat font, black & white scheme.
- **📅 Smart Calendar Spacing** — scheduled posts are spread across a monthly
  cadence on **Tuesdays & Thursdays** (configurable via `SCHEDULE_DAYS` in
  `lib/posts.ts`) instead of consecutive days, so the calendar always shows
  future, spaced-out posts.
- **©️ Automated Logo Watermark** — the transparent brand logo is cleanly
  overlaid onto the **bottom-right corner** of every post preview via a CSS
  overlay shell, strictly preserving the image's original aspect ratio (no
  crop, no distortion, no extra dependencies).
- **🔄 Expanded Generation Support** — a modular `AssetSource` provider hook
  (`generateMonthlyAssets` in `lib/posts.ts`) lets new image providers pull or
  generate fresh monthly assets without touching the display layer. Falls back
  gracefully to the static brand bundle or live Supabase rows when no provider
  is configured.

---

## 📁 Project Structure

```
portal/
├── app/
│   ├── layout.tsx / page.tsx / globals.css
│   ├── login/           # password gate
│   ├── portal/          # secure dashboard (calendar, edit, approve)
│   └── api/
│       ├── auth/        # sign-in + session check
│       ├── auth/logout/
│       ├── posts/       # GET schedule
│       └── posts/[id]/  # PATCH caption / status -> Supabase
├── lib/
│   ├── supabase.ts      # server client
│   ├── browserSupabase.ts
│   ├── auth.ts          # password verification
│   ├── posts.ts         # schedule utils, smart spacing, asset-generation hook
│   └── postsStore.ts    # DB <-> default merge logic
├── public/images/       # brand JPEGs + transparent logo
└── .env.local.example   # template env file
```

---

## 📅 Smart Scheduling & 🎨 Asset Generation (developer notes)

### Monthly cadence
`assignSchedule()` in `lib/posts.ts` spreads N posts across the next month's
**Tuesdays & Thursdays**. Change `SCHEDULE_DAYS` (0=Sun … 6=Sat) to alter the
cadence. `getPosts()` applies this automatically in demo/fallback mode.

### Adding a monthly image provider
To let the portal pull fresh imagery each month:

1. Implement the `AssetSource` interface (name, `configured`, `generate`).
2. Push it onto the `ASSET_SOURCES` registry in `lib/posts.ts`.
3. Set it as `configured` when its env vars / API key are present.

When a provider is configured, `generateMonthlyAssets()` is called on the
portal page; when none is configured it returns `null` and the portal keeps
using Supabase live rows / the static bundle — so nothing ever breaks.

---

## 🚀 One-Click Deploy to Vercel (Free Tier)

1. **Push this `portal/` folder to GitHub** (e.g. in your existing repo or a
   new repo with the `portal/` contents at the root).

2. **Import to Vercel** — go to [vercel.com/new](https://vercel.com/new),
   connect GitHub and import the repository. Vercel auto-detects Next.js
   (Framework Preset: **Next.js**, Build Command: `next build`).

3. **Add environment variables** in
   *Project → Settings → Environment Variables* (see next section).

4. Click **Deploy**. Done — the free tier is plenty for this single-app portal.

> For a sub-folder deploy (repo root containing other site files), set
> **Root Directory** to `portal` in the Vercel project settings.

---

## 🔐 Environment Variables

Copy `.env.local.example` → `.env.local` locally, and add the same in Vercel.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORTAL_PASSWORD` | ✅ | Shared secret the client enters to unlock the portal. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | From Supabase → Project Settings → API. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key (safe for browser). |

---

## 🗄️ Supabase Setup (2 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the `supabase/schema.sql` file included in this
   project to create the `social_posts` table + Row Level Security.
3. Grab the **Project URL** and **anon public key** from *Project Settings → API*.
4. Optionally pre-fill the table with your scheduled posts (see the seed in
   `supabase/schema.sql`). If the table is empty, the portal shows its built-in
   defaults and writes new rows on first save/approve (match the `id` values).

### Row Level Security (RLS)

For a simplest, zero-maintenance setup the included SQL enables public read +
write on the `social_posts` table. Because the route is already gated by the
`PORTAL_PASSWORD` cookie, public table access is acceptable for this internal
client portal. For stricter control, replace the policy with one restricted to
the anon role / a service key via an edge function.

---

## 🧑‍💻 Local Development

```bash
cd portal
npm install
cp .env.local.example .env.local   # fill in your values
npm run dev
# open http://localhost:3000
```

## 🛠️ Production Build

```bash
npm run build
npm start
```

---

## 🔒 Security Notes

- `PORTAL_PASSWORD` is only ever read on the server (never shipped to the
  browser).
- The session is an httpOnly, sameSite=lax cookie.
- If `PORTAL_PASSWORD` is unset in production, the portal **opens up** — be
  sure to set it.
- `.env*.local`, `.next`, and `node_modules` are git-ignored. **Never commit
  real secrets.**

---

© Coffs Coast Pest Control · coffscoastpc.com.au · ABN 95 610 493 013
