# Group Survival

A top-down co-op zombie wave-survival game, inspired by the pillars of
*No More Room in Hell*: a relentless horde that closes in from every
direction, scarce ammo, a melee fallback, and survivors who live or die
as a group.

## How to play

```
npm install
npm start          # serves on http://localhost:3000 (PORT to override)
```

Open `http://localhost:3000`, enter a name, and you're in. Open more
browser windows for co-op — everyone shares one world.

- **Move**: WASD or arrow keys
- **Aim**: mouse (your flashlight follows your aim — light is a resource)
- **Shoot**: left click or spacebar (arrows are scarce — count your shots)
- **Melee shove**: F (non-lethal frontal push that buys space; cheap stamina)
- **Melee swing**: V (the committed kill — narrow, slow, expensive stamina)
- **Check your quiver**: R (the arrow count only surfaces when you check or it changes)
- **Barricade**: B nails boards across the street in front of you — zombies tear
  at them instead of walking through; boards come from supply drops
- **Bandage**: H presses a bandage to an open wound. A bad bite can leave you
  **bleeding** — HP drips away and you trail blood until it's wrapped, a first
  aid kit closes it, or you bleed out
- Every 3rd wave a **helicopter supply drop** lands under a flare: arrows, meds,
  boards — and quietly, the cure
- **Respawn tokens**: every 10 kills earns the group one. Death is sticky — a
  fallen survivor returns at the next wave only if there's a token to spend,
  or mid-wave if a teammate stands over their body for a few exposed seconds
  (also one token). Up to 8 survivors share a world
- A bite can **infect** you. Only you see the veins creep in; the fever turns you
  in two minutes unless you reach a supply crate. Telling the team is your call
- Zombies rarely drop **ammo** (yellow) and **health** (red cross); the drop is the real resupply
- Each wave is bigger and tougher than the last. There is no winning, only surviving.

## Architecture

- `app.js` — Express + WebSocket server on a single port
- `game_server/game_server.js` — authoritative simulation: waves, zombie AI,
  projectiles, melee, pickups, player health. Ticks at 20Hz, broadcasts
  snapshots at ~15Hz.
- `public/javascripts/game_client.js` — WebSocket client / message layer
- `public/javascripts/game_scripts/` — Phaser 2 rendering state and local
  player input (client-predicted movement, server-owned everything else)

## Gauntlet test

`test/gauntlet.js` is an automated two-player playtest run with headless
Chromium: it joins two clients, verifies co-op sync, movement replication,
wave spawning, shooting/ammo scarcity, kills, zombie damage, HUD, and the
event feed, and fails on any client-side JS error.

```
npm start &
CHROME_PATH=/path/to/chromium node test/gauntlet.js
```
