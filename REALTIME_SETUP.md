# Alone2Lone Realtime v1

This version adds a real internet transport for:
- real-time 1-to-1 text chat
- WebRTC 1-to-1 voice/video signaling
- online/offline presence
- Socket.IO signaling

## Run locally

Requirements:
- Node.js 20+
- A browser with camera/microphone permissions

From this project root:

```bash
npm install
npm start
```

Open:
http://localhost:3000

For two-device testing on the same Wi-Fi, use your computer's LAN IP:
http://YOUR-LAN-IP:3000

For HTTPS/public video testing, deploy the Node service to a host that provides HTTPS.

## Important limitation

This is an integration/test build, not the final production backend.

The current app still uses its prototype localStorage data model for profiles/chats. The Socket.IO layer transports messages/calls between connected clients, but it does not yet persist messages to a cloud database.

WebRTC currently uses STUN only. Some networks require a TURN server for reliable calls.

The demo identity is the existing `state.profile.a2lId`; there is no server-side authentication yet.

## First test

1. Open the app on two devices/browsers.
2. Use two different A2L profile IDs.
3. Make sure both users appear online.
4. Test chat.
5. Start a voice/video call.
6. Grant camera/microphone permission.
7. Test end call and reconnect.

After this works, the next production step is authentication + PostgreSQL/Supabase persistence + TURN + security/rate limits.
