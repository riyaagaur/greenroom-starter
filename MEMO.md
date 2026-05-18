# Settlement at The Crescent: Vs Deal Calculator + Audit Trail

**Candidate:** Riya Gaur  
**Slice:** Vs deal settlement calculator with line-by-line audit trail  
**Time spent:** ~7 hours

---

## Why this slice

Vs deals represent 36% of all deals at The Crescent (195 of 537) — the single largest deal type — yet the in-app tool returns "unsupported" for every one of them. This means Mariana is forced into a Google Sheet for over a third of her shows. The other unsupported types (percentage_of_net at 20%, door at 6%) matter, but vs deals are where the volume, the complexity, and the trust risk converge.

The second half of my slice — the audit trail — follows directly from user research. Every stakeholder interview named the same need: Mariana wants "show your work," Diego wants a line-by-line walkthrough before signing, Sarah Kim (WME) wants "itemization, provenance, tone." Settlement isn't a calculation — it's a conversation. The tool needs to make the math visible, not just correct.

I chose this pair because fixing the calculator without the audit trail ships a black box, and shipping the audit trail without the calculator leaves Mariana in a spreadsheet. They're tightly coupled — one without the other doesn't move the 18% adoption number.

## What I cut and why

- **Real-time prediction / pre-show projections:** Valuable (Marcus wants Wednesday warnings), but the root cause is that settlement math doesn't work in-app at all. Prediction is a layer on top of a working calculator — premature without the foundation.
- **Post-show agent communication:** Sarah wants a structured statement she can forward. That's a formatting/export feature that becomes trivial once the audit trail exists. Ship the trail first, template the export later.
- **Dispute resolution workflow:** The Coastal Spell dispute happened because recoup placement (inside vs outside expense cap) was ambiguous. My solution prevents this class of dispute by surfacing warnings early and making deduction order explicit in the audit trail — upstream prevention rather than downstream resolution.
- **Percentage-of-net / door deals:** These are 26% combined. My vs calculator already handles net-basis math, so extending to percentage_of_net is a small incremental step. Door deals (6%) are a different model entirely — lower priority.

## What I found in the data

Exploring the SQLite database revealed several data integrity issues the brief hinted at:

- **24 settlements marked "disputed" with positive sign-off text** — "Looks good — TM," "👍," "ok wire monday." The status field contradicts the sign-off. My tool flags this mismatch with an explicit warning.
- **Structured fields that lag behind prose.** One deal's notes explicitly say "structured field still reflects original $11,000 — confirm before settlement." The `notes_freetext` is the truth; the structured fields drift. My parser extracts terms from prose so the calculator uses what Mariana actually negotiated.
- **The "hwang_pattern"** — 5+ shows with recurring disputed marketing recoups labeled "Marketing recoup (post-show pushback)," all tied to the same ambiguity the Coastal Spell dispute surfaced. This is a systemic pattern, not a one-off.
- **Mislabeled recoups** — e.g., "Spotify pre-show ad spend recoup" filed under `production_overage` instead of `marketing`.

## What I built

**Three files, one feature:**

1. **`lib/parseDealNotes.ts`** — A regex-based parser that extracts structured deal modifiers from Mariana's freetext notes: walkout pots (threshold and breakeven variants), tier ratchets, bonuses (gross threshold, attendance, sellout), and hospitality caps. Also detects stale structured fields and ambiguous recoup language.

2. **`lib/dealMath.ts` (extended)** — Added `calculateVsDeal()` supporting all five vs subtypes found in the data: standard vs-net (120 deals), walkout pot (32), tier ratchet (25), vs-gross (17), and tiered splits (1). Handles expense caps, bonus evaluation, recoup deduction, and generates a step-by-step audit trail with warnings.

3. **`components/settlement/vs-settlement.tsx`** — A client component that renders the settlement as an expandable audit trail. Each line is clickable to reveal source data. Warnings surface at the top: disputed recoups, status/signoff mismatches, logged-vs-calculated discrepancies, expense overages, hospitality cap breaches, and stale structured fields.

**Design decisions:**

- **Disputed recoups shown but not deducted.** The total reflects what the artist would receive if all disputed items resolve in their favor. This matches how Mariana actually settles — she shows the TM the clean number and negotiates recoups separately.
- **Warnings, not blockers.** The tool flags problems (status mismatch, stale fields, ambiguous recoups) but doesn't prevent settlement. Mariana needs to settle at 2am whether the data is clean or not. The tool should inform her judgment, not substitute for it.
- **Freetext as source of truth.** Rather than requiring Mariana to re-enter deal terms in structured fields, the parser extracts from what she already writes. This respects her existing workflow and the reality that prose captures nuance structured fields can't.

## How I'd validate

1. **Mariana first.** Sit with her for 3 settlement nights. Does the audit trail match her spreadsheet? Does she trust it enough to show the TM? Where does she still reach for the sheet?
2. **5-10 beta venues.** Track: time-to-settle, spreadsheet fallback rate, dispute rate on vs deals, and whether bookers use the tool or screenshot it.
3. **Key metric:** In-app settlement completion rate for vs deals (currently 0% → target 60%+ within 90 days of launch).

## What ships next

1. **Percentage-of-net support** — the net-basis math already exists; this is mostly a routing change.
2. **Agent-facing export** — a structured settlement statement (PDF/email) generated from the audit trail, with the "itemization, provenance, tone" Sarah Kim asked for.
3. **Wednesday warnings** — surface ambiguous deals and expense overages mid-week so Mariana can resolve with the agent before settle night.
4. **Recoup placement rules** — structured field for "inside expense cap" vs "outside expense cap" vs "against gross" — the exact ambiguity that caused the Coastal Spell dispute.