# The Gauntlet Prompt

Produced by the `gauntlet-loop` skill (`.claude/skills/gauntlet-loop/`,
technique by Matt Shumer, skill by RoboNuggets). Paste-ready:

---

Build the Group Survival browser game into a co-op zombie survival experience.

The bar is No More Room in Hell, its Survival mode. Get the real thing first:
its documented mechanics, HUD philosophy, and atmosphere are pinned with
sources in gauntlet/BAR.md. Compare against that directly, not against a vague
memory of it.

Break this into the smallest pieces that can be improved and judged on their
own — atmosphere and lighting, HUD and information design, the horde and the
world, combat feel, mechanics parity. For each piece, fan out a builder and a
separate critic with fresh context. The critic opens the running game's actual
screenshots, puts them against the bar, says which is better, and names the
single biggest remaining gap. Then it goes back to the builder.

The critic should be a harsh critic. Praise is not useful. If ours does not
win, it keeps going. A tie is a loss.

/loop on each piece until the critic picks ours. Do not stop before that. The
functional gauntlet (test/gauntlet.js) must stay green every round.

Fan out subagents and ultracode.

---

## Environment note

The build environment's network egress blocks every image host (Steam, ModDB,
Wikipedia, GitHub's attachment CDN), so the bar could not be fetched as
screenshots. The closest fetchable form was used instead: NMRiH's documented
mechanics and reviewed atmosphere, gathered from published sources into
gauntlet/BAR.md. Critics judge real screenshots of our game against that
specification, binary verdict, tie-loses.
