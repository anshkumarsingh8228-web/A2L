# Alone2Lone (A2L) — Phase 12 Final

Cumulative final checkpoint containing the A2L work from Phases 1–11.

## Included
- Supabase Auth/session bridge
- Authenticated WebSocket identity
- Server-authoritative Quick Match
- 1-to-1 WebRTC video and voice
- Split-screen call UI and camera/mic controls
- Camera front/back switch and camera-off identity state
- Realtime reactions
- Friends and friend requests
- Separate realtime chat
- Seven-day chat retention/purge prototype
- Block/report safety layer
- Free vs Premium entitlement architecture
- Render deployment configuration

## Production environment
Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `AUTH_REQUIRED=true` on the server.
Never expose a Supabase service-role key to the browser.

## Final device test
Test two authenticated accounts on separate devices: presence, Quick Match,
WebRTC audio/video, camera switching, reactions, friend requests, friend calls,
separate chat, block/report, premium authorization, reconnects, and mobile
camera/microphone permissions.

## Launch note
This is a production-oriented prototype. TURN, payments, stronger moderation,
persistent Supabase-backed social/chat/safety data, and additional rate limits
should be completed before a public launch.
