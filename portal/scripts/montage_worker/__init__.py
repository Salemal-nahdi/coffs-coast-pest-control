"""Montage worker — server-side media processing bridge for Coffs Coast Pest Control.

This package connects the social media approval portal's Supabase backend to the
OpenMontage media pipeline.

Flow:
    1. Connect to Supabase using environment variables (publishable / anon key).
    2. Fetch pending records from public.social_posts that are waiting for a
       generated media_url (media_type='video' with status='Draft'/'Queued' and
       no media_url, or media_type='image' flagged for montage).
    3. Process assets through the OpenMontage pipeline to generate the final
       media file(s).
    4. Update the database record with the generated media_url and set status.

The worker is designed to be runnable as a cron job / scheduled task and to degrade
gracefully when the local OpenMontage render engines are unavailable (matching the
project's zero-maintenance philosophy).
"""
