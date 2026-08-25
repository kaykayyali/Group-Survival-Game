# Gauntlet Result: Ours, on all five pieces

Seven rounds against the bar of *No More Room in Hell* (Survival mode),
judged by fresh-context critics on real screenshots of the live game held
next to six real frames of the reference. Exit condition: every critic
picks ours. Reached in round 7.

## Final verdicts (round 7 — five independent critics, tie-loses)

- **Atmosphere & lighting — OURS WINS.** "Zombie sprites are explicitly
  gated — fully skipped when neither the beam, a barrel, nor point-blank
  range applies, so the horde genuinely is not there until light finds it…
  an honest, mechanically real translation of NMRiH's darkness-that-hides-
  threats into top-down 2D, not a cosmetic dark filter."
- **HUD & information — OURS WINS.** "Same serif face, same two-tone
  coloring, same four-line label set and order… no health/stamina/ammo bar
  visible in any shot" — health is read off the screen itself.
- **Horde & world — OURS WINS.** "A genuine 5–6 zombie pack walking
  together into a light pool… genuinely shoulder-to-shoulder" — pulse
  spawning verified in code and in brightened frame crops.
- **Combat feel — OURS WINS.** "A blood-caked axe sprite actually swept
  through the arc… permanent corpse decals stamped into a canvas that's
  never cleared… a downed state with YOU ARE DOWN + buy-back text."
- **Mechanics parity — OURS WINS.** Zones, supply drops, respawn tokens,
  mid-wave revival, infection, bleeding, barricades, split melee, ammo
  friction, darkness, 8-player co-op — all server-authoritative.

## The road (verdict history)

| Piece      | R1 | R3 | R4 | R5 | R6 | R7 |
|------------|----|----|----|----|----|----|
| Atmosphere | ✗  | ✓  | ✗  | ✓  | ✗  | ✓  |
| HUD        | ✗  | ✗  | ✓  | ✓  | ✓  | ✓  |
| Horde      | ✗  | ✗  | ✗  | ✗  | ✗  | ✓  |
| Combat     | ✗  | ✗  | ✗  | ✗  | ✓  | ✓  |
| Mechanics  | ✗  | ✓  | ✓  | ✓  | ✓  | ✓  |

(R2 was the wide pass: a 15-lens panel plus a QA swarm whose adversarial
skeptics confirmed 21 real bugs, all fixed.)

## What the loop forced into existence

Round by round, the critics' named gaps became: the darkness mask and
flashlight; the removal of every permanent readout; walkers, runners and
crawlers; the ruined-crossroads map; safe zones A/B with the reference's
exact tally; supply drops, respawn tokens, infection, bleeding,
barricading, melee split into shove and killing swing, mid-wave revival;
release flashes that strobe above the dark; packs that arrive together;
bodies — zombie and survivor — that stay where they fell.

Functional playtest (`test/gauntlet.js`, two headless co-op clients,
14 checks): green on every committed round.

Remaining polish the final critics volunteered (no piece hinges on them):
a cool-toned light source or two against the amber; inline label-value
spacing on the tally; brighter close-range payoff on flash and spatter;
synchronized pack headings at spawn.
