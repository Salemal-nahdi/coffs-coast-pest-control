# Project Context & Environment (`context.md`)

## Business Profile
- **Business Name:** Coffs Coast Pest Control (coffscoastpc.com.au)
- **Operating Region:** Coffs Harbour, Woolgoolga, Corindi Beach, Sawtell, Bellingen.
- **Core Services:** Residential & commercial pest control, termite inspections (AS 3660 compliant), general pest treatments, and preventative management plans.
- **Owner:** Cristian O'Brien · 0449 252 963 · coffscoastpc@gmail.com · ABN 95 610 493 013
- **Brand:** Montserrat font, black & white colour scheme, transparent logo.

## Repository Architecture & Stack
- **Filespace:** Static HTML/CSS/JS architecture paired with modern styling structures.
- **Key Assets:** `logo-no-background.png`, custom service area landing pages, and modular form components.
- **Deployment Target:** GitHub repository linked to automated Vercel production hosting.

### Brand Asset Locations (root of repo)
| Asset | Path | Notes |
|-------|------|-------|
| Transparent logo | `logo-no-background.png` | 500×500 RGBA. **Always** placed inside a solid black container to pop; never crop or distort. |
| Hero/post imagery | `COFFSCOASTHR-1.jpg` … `COFFSCOASTHR-15.jpg` | High-res portrait & landscape JPEGs. Preserve original aspect ratio; never crop/distort. |
| Portal copies | `portal/public/images/` | Same assets mirrored for the client portal (p1–p6 + logo). |

## Client Social Media Approval Portal (`portal/`)
- **Stack:** Next.js 14 (App Router) + Supabase (Postgres + anon key) + Vercel (free tier).
- **Purpose:** Let the client review a scheduled content calendar, edit captions inline, and approve posts — syncing status to Supabase, gated by a `PORTAL_PASSWORD`.
- **Key files:** `portal/app/portal/Dashboard.tsx` (calendar/edit/approve), `portal/app/api/posts/[id]/route.ts` (Supabase writes), `portal/lib/posts.ts` (default schedule).
- **One-click deploy:** see `portal/README.md`. Env vars: `PORTAL_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **DB setup:** run `portal/supabase/schema.sql` in the Supabase SQL editor (creates `social_posts` table + RLS).

## Active Project Goals
1. **Digital On-Site Reporting & CRM Pipeline:** Mobile-first inspection report templates (General Pest & AS 3660 Termite) that generate client-ready PDFs and feed Google Sheets CRM records.
2. **Client Social Media Approval Portal:** Next.js/Supabase/Vercel portal for caption editing and post approval (see above).
