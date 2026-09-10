# Alone2Lone (A2L) – Production Candidate

This build keeps one authoritative video-call renderer and one primary realtime WebSocket. Video Match is intentionally separate from Voice/Chat UI.

## Required deployment variables

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on Render. `AUTH_REQUIRED` may be enabled after Supabase Auth is configured for the deployment.

## Supabase one-time setup

Run `supabase/production_migration.sql` once against project `kxvlhajuxbnwkejchhrt`. It adds conversation helpers, message idempotency, profile/friend indexes, avatar storage policies, and realtime message publication.

## Architecture

- Supabase: auth, persistent profiles, avatars, friendships, conversations and messages.
- Render/WebSocket: presence, matching, realtime routing and WebRTC signaling.
- WebRTC: peer-to-peer audio/video media.
- LocalStorage: UI cache only; it is not the source of truth for persistent profile data.

## Video UI

The call screen has one renderer: remote video on top, local video on bottom, centered A2L divider, one identity pill, one Next Match control for random matches, and one control row. Legacy voice/call UI does not render inside the video modal.
