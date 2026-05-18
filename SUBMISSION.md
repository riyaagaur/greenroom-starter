Greenroom Applied AI PM Case Study
Name: Riya Gaur        Date: May 17, 2026       Slice: Vs Deal Settlement Calculator + Audit Trail
 
Deliverables
GitHub Repo (forked): https://github.com/riyaagaur/greenroom-starter
 Branch: feature/vs-settlement-audit-trail
Loom Walkthrough: https://www.loom.com/share/129fc30fda214083af69329bdf1af985
 
1. The Slice: Why Vs Deals + Audit Trail
Vs deals represent 36% of all deals at The Crescent (195 of 537) — the single largest deal type — yet the in-app tool returns "unsupported" for every one of them. Mariana is forced into a Google Sheet for over a third of her shows.
The audit trail follows directly from user research. Every stakeholder named the same need: Mariana wants "show your work," Diego wants a walkthrough before signing, Sarah Kim wants "itemization, provenance, tone." Settlement is a conversation, not a calculation.
I chose this pair because fixing the calculator without the audit trail ships a black box, and shipping the audit trail without the calculator leaves Mariana in a spreadsheet. They're tightly coupled — one without the other doesn't move the 18% adoption number.
2. What I Cut and Why
Real-time prediction / pre-show projections: Valuable for Marcus's Wednesday warnings, but prediction is a layer on top of a working calculator. Premature without the foundation.
Post-show agent communication: Sarah wants a structured statement to forward. That's a formatting/export feature that becomes trivial once the audit trail exists. Ship the trail first, template the export later.
Dispute resolution workflow: The Coastal Spell dispute happened because recoup placement (inside vs outside expense cap) was ambiguous. My solution prevents this class of dispute by surfacing warnings early and making deduction order explicit — upstream prevention rather than downstream resolution.
Percentage-of-net / door deals: 26% combined. My vs calculator already handles net-basis math, so extending to percentage_of_net is a small incremental step. Door deals (6%) are a different model — lower priority.
3. What I Found in the Data
Exploring the SQLite database directly revealed several data integrity issues:
24 settlements marked "disputed" with positive sign-off text. Examples: "Looks good — TM," "👍," "ok wire monday." The status field contradicts the sign-off. My tool flags this mismatch with an explicit warning.
Structured fields that lag behind prose. One deal's notes explicitly say "structured field still reflects original $11,000 — confirm before settlement." The freetext is the truth; the structured fields drift.
The "hwang_pattern." 5+ shows with recurring disputed marketing recoups all labeled "Marketing recoup (post-show pushback)." This is a systemic pattern tied to the same ambiguity the Coastal Spell dispute surfaced, not a one-off.
Mislabeled recoups. For example, "Spotify pre-show ad spend recoup" filed under production_overage instead of marketing.
Vs deal subtypes are varied. 120 standard vs-net, 32 walkout pots, 25 tier ratchets, 17 vs-gross, 1 tiered split. 58% of vs deals include bonuses. The calculator needed to handle all of these — bonuses aren't edge cases.
4. What I Built
Three files, one feature:
lib/parseDealNotes.ts — A regex-based parser that extracts structured deal modifiers from Mariana's freetext notes: walkout pots (threshold and breakeven variants), tier ratchets, bonuses (gross threshold, attendance, sellout), and hospitality caps. Also detects stale structured fields and ambiguous recoup language.
lib/dealMath.ts (extended) — Added calculateVsDeal() supporting all five vs subtypes. Handles expense caps, bonus evaluation, recoup deduction, and generates a step-by-step audit trail with warnings.
components/settlement/vs-settlement.tsx — A client component that renders the settlement as an expandable audit trail. Each line is clickable to reveal source data. Warnings surface at the top for disputed recoups, status/signoff mismatches, logged-vs-calculated discrepancies, expense overages, hospitality cap breaches, and stale structured fields.
5. Design Decisions
Disputed recoups shown but not deducted. The total reflects what the artist would receive if all disputed items resolve in their favor. This matches how Mariana actually settles — she shows the TM the clean number and negotiates recoups separately.
Warnings, not blockers. The tool flags problems but doesn't prevent settlement. Mariana needs to settle at 2am whether the data is clean or not. The tool should inform her judgment, not substitute for it.
Freetext as source of truth. Rather than requiring Mariana to re-enter deal terms in structured fields, the parser extracts from what she already writes. This respects her existing workflow and the reality that prose captures nuance structured fields can't.
6. Validation Plan
1.	Mariana first. Sit with her for 3 settlement nights. Does the audit trail match her spreadsheet? Does she trust it enough to show the TM?
2.	5–10 beta venues. Track: time-to-settle, spreadsheet fallback rate, dispute rate on vs deals.
3.	Key metric: In-app settlement completion rate for vs deals — currently 0%, target 60%+ within 90 days.
7. What Ships Next
1.	Percentage-of-net support — the net-basis math already exists; mostly a routing change.
2.	Agent-facing export — structured settlement statement (PDF/email) generated from the audit trail with the itemization and provenance Sarah Kim asked for.
3.	Wednesday warnings — surface ambiguous deals and expense overages mid-week so Mariana can resolve before settle night.
4.	Recoup placement rules — structured field for "inside expense cap" vs "outside expense cap" vs "against gross" — the exact ambiguity that caused the Coastal Spell $720 concession.
