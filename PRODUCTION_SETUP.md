# Alone2Lone production setup

## Already aligned
- Existing Supabase UUID profile/auth model is the source of truth.
- Node backend authenticates every API/WebSocket request with Supabase access tokens.
- Profiles, friend requests, friendships, chat requests, conversations/messages, call history, reconnect requests and notifications persist in PostgreSQL.
- Random matching and WebRTC signaling use the Render backend WebSocket.
- WebRTC uses STUN and accepts optional TURN settings.

## Render environment variables
Set these on the existing `alone2lone` Render service:

- `DATABASE_URL` — Supabase Postgres connection string (keep private; use the pooled connection string when appropriate).
- `SUPABASE_URL` — `https://kxvlhajuxbnwkejchhrt.supabase.co`
- `SUPABASE_ANON_KEY` — the Supabase publishable/legacy-compatible public client key.
- `REQUIRE_AUTH=true`
- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` — optional until a TURN provider is configured.

Do **not** put a service-role key in browser code.

## Supabase Auth dashboard
Enable:
- Email/password
- Google OAuth
- Anonymous sign-ins (for Guest)

For Google, add the Render production URL as an allowed redirect URL in Supabase Auth and configure the Google OAuth client credentials in Supabase.

## Database
The live project has already been aligned with `supabase/production_alignment.sql`. Keep future database changes as migrations; do not replace the existing production schema with the older prototype schema.

## WebSocket
The frontend connects to the same origin, so the deployed Render service is the signaling endpoint automatically (`wss://alone2lone.onrender.com`).

## TURN
STUN is included by default. For reliable calls across restrictive NAT/mobile networks, configure a TURN service through the three Render environment variables above.
