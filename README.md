# A2L — A-to-Z Verified Live Build

This build is a repaired cumulative prototype for Alone2Lone.

## Verified/fixed integration points
- Browser loads every required local JavaScript module with `/js/...` paths.
- CSS is served from `/css/style.css`.
- Supabase browser bridge is served correctly and uses only the publishable key.
- One shared browser session identity is used for live routing.
- One primary WebSocket is used for presence, matching, WebRTC signaling, reactions, friend requests and live chat; duplicate same-session sockets are avoided.
- Quick Video Match and Quick Voice Match call the live queue directly instead of searching a local friend array.
- Live matching supports video, voice and text modes.
- Public A2L handle (`a2lId`) is kept separate from the private live routing id (`userId`).
- Suggested Friends can display/search another currently connected account by name or public A2L ID.
- Friend requests route to the live user's routing id and accept/decline through the live socket.
- Accepted friend chats are available to free users.
- Stranger chat has a working live text-match entry point.
- Live text chat messages route directly between matched users.
- Server blocks prevent matching/routing to blocked users.
- Node syntax checks pass for all JavaScript files in this build.

## Render environment
Set:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `AUTH_REQUIRED=false` for the current anonymous prototype

Never place a Supabase secret/service-role key in the browser.
