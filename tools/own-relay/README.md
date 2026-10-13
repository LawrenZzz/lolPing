# own-relay

A minimal Nostr relay for running lolPing's internet rooms on **your own server** instead of the public relays.
It is grown from `tests/main/fixtures/fakeRelay.ts`, the reference server the test suite runs against, so the app
works against it unmodified — the only client change is pointing `src/main/relays.ts` at it.

It speaks exactly what `src/main/relayConnection.ts` uses (REQ / EVENT / CLOSE in; EVENT / OK / EOSE out) and stores
nothing: kind 24747 events are fanned out to every matching subscription, the author's included (the app's health
model is echo-credit — no echo, and it marks the relay down). No AUTH, no PoW, no history.

## Run

```bash
npm install
node relay.mjs                 # PORT (default 37979) and HOST (default 0.0.0.0) via env
curl http://127.0.0.1:37979/health   # → ok
```

## Verify before shipping

The go/no-go probe the project uses for public relays works the same here:

```bash
node tools/relay-probe/run.mjs --relays ws://YOUR-SERVER:37979 --soak-min 0
```

and an end-to-end check with two fake members through it:

```bash
# with RELAYS temporarily pointed at your server
node tools/room-peer/run.mjs PING-XXXXX-XXXXX --relay --name BotA --port 47475
node tools/room-peer/run.mjs PING-XXXXX-XXXXX --relay --name BotB --port 47476
```

## Notes

- **TLS:** `ws://IP:port` works — room packets are end-to-end sealed (AES-256-GCM from the room code), so the relay
  only ever sees metadata (anonymous room topic, throwaway pubkeys, timing, IPs). Put Caddy in front for `wss://` if
  you have a domain; some networks are friendlier to TLS on 443.
- **Firewall:** open the TCP port both in the cloud security group and on the host (e.g. `ufw allow 37979/tcp`).
- **Keep it running:** a systemd unit with `Restart=always` (or pm2) survives reboots and crashes.
- **Compatibility:** a list holding only your relay means the fork meets only clients pointed at the same relay.
  Append yours to the public list instead if you also want to meet upstream users.
