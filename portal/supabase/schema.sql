-- ============================================================
-- Coffs Coast Pest Control — Client Social Media Approval Portal
-- Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor).
-- This CREATEs the table + RLS policy so live read/write works with
-- the project's public (publishable/anon) API key.
-- ============================================================

-- Clean up if re-running (optional)
drop table if exists public.social_posts;

-- Posts table — supports images and short-form .mp4 video (.media_type/.media_url)
create table public.social_posts (
  id                  text primary key,
  date                text not null,             -- ISO date "2026-08-10"
  platform            text not null,             -- Facebook / Instagram / Google Business Profile
  caption             text not null default '',
  image               text not null,             -- path like "/images/p1.jpg" (or data URI for uploads)
  status              text not null default 'Draft' check (status in ('Draft','Approved')),
  flagged_for_review  boolean not null default false,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- 10-to-6 batch workflow metadata (kept optional for backward compat)
  topic               text,
  angle               text,
  image_variant       text,
  uploaded            boolean not null default false,

  -- Mixed-media: short-form branded videos (.mp4)
  media_type          text check (media_type in ('image','video')),
  media_url           text
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_social_posts_updated
before update on public.social_posts
for each row execute function public.set_updated_at();

-- Enable Row Level Security and allow public read/write.
-- The portal is gated by the PORTAL_PASSWORD cookie, so this simple
-- policy keeps setup to zero maintenance. Tighten if you need strict auth.
alter table public.social_posts enable row level security;

-- Target the public roles explicitly (publishable/anon + authenticated).
drop policy if exists "public_access" on public.social_posts;
create policy "public_access"
  on public.social_posts
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Expose the table to the Data (REST) API for the public roles.
-- WITHOUT these GRANTs a freshly created table is NOT reachable via the
-- Data API even with RLS enabled + a policy (Supabase Data API settings
-- control Data API access separately from RLS row visibility).
grant select, insert, update, delete on public.social_posts to anon, authenticated;

-- ------------------------------------------------------------
-- Seed — matches the portal's built-in defaults (images + 2 videos).
-- Adjust dates/content as you like.
-- ------------------------------------------------------------
insert into public.social_posts
  (id, date, platform, caption, image, status, media_type, media_url, topic, angle, image_variant) values
  ('post-1', '2026-08-10', 'Instagram', '🐜 Protecting Coffs Harbour homes year-round. Book your general pest treatment today — call Cristian on 0449 252 963. #CoffsCoastPestControl #PestFreeHome', '/images/p1.jpg', 'Draft', 'image', null, 'general-pest', 'call-to-book', 'p1'),
  ('post-2', '2026-08-11', 'Facebook', 'Did you know termites cause more damage than fire each year in Australia? Stay ahead with an AS 3660 compliant termite inspection. ☎️ 0449 252 963', '/images/p2.jpg', 'Draft', 'image', null, 'termite-guard', 'as3660-education', 'p2'),
  ('post-3', '2026-08-12', 'Facebook', 'Rodent-free means rest easy. Discreet, effective rodent control across the Coffs Coast. ABN 95 610 493 013. Message us to book a spring clean treatment.', '/images/p3.jpg', 'Draft', 'image', null, 'rodent-control', 'peace-of-mind', 'p3'),
  ('post-4', '2026-08-13', 'Instagram', 'Your local, family-run pest experts 🏡 Coffs Harbour, Woolgoolga, Sawtell & beyond. Free quotes — call 0449 252 963 today!', '/images/p4.jpg', 'Draft', 'image', null, 'local-experts', 'family-run', 'p4'),
  ('post-5', '2026-08-14', 'Google Business Profile', 'Loved by our local customers ⭐ Friendly, thorough and reliable pest control. If you''ve used our service, we''d be grateful for your Google review!', '/images/p5.jpg', 'Draft', 'image', null, 'reviews', 'google-reviews', 'p5'),
  ('post-6', '2026-08-15', 'Facebook', 'Spider season is coming 🕷️ Put the kettle on and leave the web-work to us. General pest + spider treatment, one call: 0449 252 963.', '/images/p6.jpg', 'Draft', 'image', null, 'spider-season', 'seasonal-prep', 'p6'),
  ('post-7', '2026-08-17', 'Instagram', 'Watch how an AS 3660 compliant termite inspection protects your home — 30-second rundown with Cristian. ☎️ 0449 252 963', '/images/p2.jpg', 'Draft', 'video', '/media/termite-inspection.mp4', 'termite-guard', 'video-overview', 'v1'),
  ('post-8', '2026-08-19', 'Facebook', 'Rodent control in action 🎥 Discreet, effective, and finished in one visit. Book today — 0449 252 963.', '/images/p3.jpg', 'Draft', 'video', '/media/rodent-control.mp4', 'rodent-control', 'video-howto', 'v2');

-- ============================================================
-- Supabase Storage — asset bundle persistence (PRODUCTION)
-- ============================================================
-- Run this ONCE (idempotent) in the Supabase SQL Editor AFTER the table
-- section above is applied. This is REQUIRED for the "Approved Asset Bundle"
-- download to work on serverless (Vercel) deployments: the montage worker
-- uploads each generated ZIP here, and the dashboard /api/zips route + the
-- worker's notification email both link to these public files.
--
-- The project's public API key CANNOT create buckets (RLS blocks it), so this
-- must be applied manually — same as the table/schema section above.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asset-bundles', 'asset-bundles', true,
        -- 50 MB cap is plenty for an 8-image + 3-video bundle.
        52428800,
        array['application/zip'])
on conflict (id) do update
  set public = true,
      allowed_mime_types = array['application/zip'];

-- Allow public read for anonymous downloads (public bucket read).
-- Storage objects require their own RLS policies separate from the table.
drop policy if exists "public_read_asset_bundles" on storage.objects;
create policy "public_read_asset_bundles"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'asset-bundles');

-- Allow the public/anon key (used by the worker) to write objects into the
-- bucket. The worker authenticates with the publishable/anon key, so grant it
-- insert + update on the zips prefix of the asset-bundles bucket.
drop policy if exists "public_write_asset_bundles" on storage.objects;
create policy "public_write_asset_bundles"
  on storage.objects
  for all
  to anon, authenticated
  using (bucket_id = 'asset-bundles' and (storage.foldername(name))[1] = 'zips')
  with check (bucket_id = 'asset-bundles' and (storage.foldername(name))[1] = 'zips');

-- Delete policy so a future cleanup job can remove stale bundles.
drop policy if exists "public_delete_asset_bundles" on storage.objects;
create policy "public_delete_asset_bundles"
  on storage.objects
  for delete
  to anon, authenticated
  using (bucket_id = 'asset-bundles' and (storage.foldername(name))[1] = 'zips');
