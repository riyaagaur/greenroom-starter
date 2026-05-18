# Build Process Log
**Tools:** Claude (thought partner), Cursor (code editor + agent), SQLite CLI

---

## Discovery — What the data actually says

Started by ignoring the UI entirely and going straight to the database. The brief hinted at embedded data problems, so I queried `greenroom.db` directly before forming any opinions.

Key things I found that shaped my approach:

- **Vs deals are 36% of all deals (195/537) and 0% work in-app.** That's not a gap — that's a broken core workflow.
- **Vs deals aren't one thing.** Classified five subtypes from the `deal_notes_freetext` field: 120 standard vs-net, 32 walkout pots, 25 ratchets, 17 vs-gross, 1 tiered split. 58% include bonuses. A calculator that only handles "standard" misses half the deals.
- **24 settlements have status "disputed" but positive sign-off text** — "Looks good," "👍," "ok wire monday." Nobody's catching this.
- **The "hwang_pattern"** — 5+ shows with the same recurring marketing recoup dispute, all tied to ambiguous "inside vs outside expense cap" language. The Coastal Spell $720 concession wasn't a one-off; it's a systemic failure.
- **Structured fields lie.** One deal's notes literally say "structured field still reflects original $11,000 — confirm before settlement." Mariana enters deals as prose because the structured fields can't model what she negotiates.

These findings drove every design decision that followed.

## Slice selection — Why this and not the others

Chose **vs deal calculator + audit trail** because:

1. It's the root cause. If the tool can't do the math, nothing downstream (predictions, agent exports, dispute workflows) matters. Mariana is in a spreadsheet because the engine is broken.
2. Every stakeholder said the same thing differently: "show your work" (Mariana), "math must be visible" (Diego), "itemization, provenance, tone" (Sarah Kim). The audit trail is the trust mechanism.
3. They're inseparable. A calculator without a trail is a black box. A trail without a calculator is documentation of nothing.

What I cut: real-time predictions (layer on top of a working calculator — premature), agent exports (formatting problem that's trivial once the trail exists), dispute resolution (my approach prevents disputes upstream by making deduction order explicit).

## Implementation approach

Worked outward from the data:

1. **Built the freetext parser first** — designed it around the five subtypes I identified in the database, pattern-matching against actual deal notes. This was the key unlock: if you can parse what Mariana writes, you don't need her to re-enter terms in structured fields.

2. **Extended the calculation engine** — added a dedicated vs-deal path that handles net vs gross basis, expense caps, ratchets, walkout pots, and bonuses from both structured fields and parsed notes. Every step produces an audit trail entry and warnings array.

3. **Built the settlement UI** — expandable audit trail where each line shows the number and, on click, where it came from. Warnings surface at the top. Styled to match Greenroom's existing design so it feels native, not bolted on.

Used Claude as a thought partner for architecture decisions and Cursor's agent for code generation. I directed the what and why; AI accelerated the how. Validated every calculation against the actual data — for example, confirmed the Coastal Spell math matches the dispute thread numbers, verified the Park Avenue ratchet correctly applies the base rate at 50% capacity.

## Key design decisions

- **Disputed recoups shown but not deducted.** Matches how Mariana actually settles — show the clean number, negotiate recoups separately.
- **Warnings, not blockers.** It's 2am. Mariana needs to settle whether the data is perfect or not. The tool informs her judgment; it doesn't gatekeep.
- **Freetext is the source of truth.** Don't fight the user's workflow — parse what they already write.

## Non-obvious finding

The Quiet Houses shows a $2,800 gap between the logged settlement ($12,506) and the calculated total ($15,310). This is a vs-gross deal where no expenses should be deducted before the percentage — but the off-platform spreadsheet appears to have deducted them anyway. If this pattern holds across venues, artists are being systematically underpaid on vs-gross deals because the math is being done incorrectly outside the tool. That's a trust risk Greenroom is uniquely positioned to surface and fix.