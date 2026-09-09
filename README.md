# Alone2Lone (A2L) — G Profile

This build includes real cross-device 1-to-1 WebRTC voice/video calling.

## Run locally

```bash
cd server
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy

Deploy the project as a Node web service (for example on Render). The service must support WebSockets and HTTPS. `render.yaml` is included.

## Two-device test

1. Open the same HTTPS app URL on two physical devices.
2. Use two different A2L profiles/IDs.
3. Allow microphone/camera access.
4. Make sure the target profile is online.
5. Start a voice or video call and accept it on the second device.

WebRTC carries the audio/video peer-to-peer. The Node WebSocket server is used only for signaling (offer/answer/ICE and call state).
