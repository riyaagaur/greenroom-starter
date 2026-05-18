/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * Supported deal types:
 *   - flat
 *   - percentage_of_gross
 *   - vs (guarantee vs % of net or gross, with walkout/ratchet from prose)
 *
 * Still unsupported: percentage_of_net, door, comps affecting gross.
 */

import type { Deal, Expense, TicketSale, Bonus, Recoup, Settlement } from "@/db/schema";
import {
  parseDealNotes,
  detectStaleStructuredFields,
  type ParsedNoteBonus,
} from "@/lib/parseDealNotes";

export type AuditTrailEntry = {
  step: number;
  label: string;
  value: number;
  explanation: string;
};

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      totalToArtist: number;
      steps: { label: string; value: number; note?: string }[];
      finalFormula: string;
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
      auditTrail?: AuditTrailEntry[];
      guaranteeWon?: boolean;
      warnings?: string[];
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

/** Optional settlement row fields used for warnings (show may have no settlement yet). */
export type SettlementCalcMeta = Pick<
  Settlement,
  "status" | "signoffText" | "totalToArtist"
>;

export interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  venueCapacity?: number;
  ticketsSold?: number;
  recoups?: Recoup[];
  settlement?: SettlementCalcMeta | null;
}

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function noteBonusesToStructured(notes: ParsedNoteBonus[]): Bonus[] {
  return notes.map((b) => {
    if (b.type === "gross_threshold") {
      return {
        type: "gross_threshold" as const,
        label: b.label,
        threshold: b.threshold,
        amount: b.amount,
      };
    }
    if (b.type === "attendance_threshold") {
      return {
        type: "attendance_threshold" as const,
        label: b.label,
        threshold: b.threshold,
        amount: b.amount,
      };
    }
    return { type: "sellout" as const, label: b.label, amount: b.amount };
  });
}

function isWalkoutBonus(b: Bonus): boolean {
  return (
    b.type === "gross_threshold" &&
    /walkout/i.test(b.label)
  );
}

function percentageFromTierRatchet(
  bonus: Extract<Bonus, { type: "tier_ratchet" }>,
  fillRatio: number,
): number {
  for (const tier of bonus.tiers) {
    const upper = tier.to ?? Infinity;
    if (fillRatio >= tier.from && fillRatio < upper) {
      return tier.percentage;
    }
  }
  return bonus.tiers[bonus.tiers.length - 1]!.percentage;
}

function resolveVsPercentage(
  deal: Deal,
  structuredBonuses: Bonus[],
  parsedNotes: ReturnType<typeof parseDealNotes>,
  fillRatio: number | null,
): { percentage: number; explanation?: string } {
  let pct = deal.percentage!;
  let explanation: string | undefined;

  if (parsedNotes.ratchet && fillRatio != null) {
    const threshold = parsedNotes.ratchet.capacityThreshold;
    const base = Number.isNaN(parsedNotes.ratchet.basePercent)
      ? pct
      : parsedNotes.ratchet.basePercent;
    if (fillRatio >= threshold) {
      pct = parsedNotes.ratchet.escalatedPercent;
      explanation = `Ratchet active (${(fillRatio * 100).toFixed(0)}% capacity ≥ ${(threshold * 100).toFixed(0)}%) — using ${(pct * 100).toFixed(0)}%`;
    } else {
      pct = base;
      explanation = `Base rate ${(pct * 100).toFixed(0)}% (${(fillRatio * 100).toFixed(0)}% capacity sold)`;
    }
  }

  const tierRatchet = structuredBonuses.find(
    (b): b is Extract<Bonus, { type: "tier_ratchet" }> => b.type === "tier_ratchet",
  );
  if (tierRatchet && fillRatio != null) {
    pct = percentageFromTierRatchet(tierRatchet, fillRatio);
    explanation = `Tier ratchet — ${(pct * 100).toFixed(0)}% at ${(fillRatio * 100).toFixed(0)}% capacity sold`;
  }

  return { percentage: pct, explanation };
}

function resolveWalkoutAmount(
  grossBoxOffice: number,
  deal: Deal,
  parsedNotes: ReturnType<typeof parseDealNotes>,
  structuredBonuses: Bonus[],
  cappedExpenses: number,
): { amount: number; explanation: string } {
  if (parsedNotes.walkout) {
    const threshold =
      parsedNotes.walkout.kind === "threshold"
        ? parsedNotes.walkout.threshold
        : (deal.guaranteeAmount ?? 0) + cappedExpenses;
    const amount = Math.max(0, grossBoxOffice - threshold);
    return {
      amount,
      explanation:
        parsedNotes.walkout.kind === "breakeven"
          ? `Walkout above breakeven ($${threshold.toLocaleString()} = guarantee + expenses)`
          : `100% of gross above $${threshold.toLocaleString()}`,
    };
  }

  const walkoutBonus = structuredBonuses.find(isWalkoutBonus);
  if (walkoutBonus && walkoutBonus.type === "gross_threshold") {
    const amount = Math.max(0, grossBoxOffice - walkoutBonus.threshold);
    return {
      amount,
      explanation: walkoutBonus.label,
    };
  }

  return { amount: 0, explanation: "" };
}

function buildWarnings(
  input: CalcInput,
  totalToArtist: number,
  rawExpenseTotal: number,
  cappedExpenses: number,
  approvedExpenses: Expense[],
  parsedNotes: ReturnType<typeof parseDealNotes>,
): string[] {
  const warnings: string[] = [];
  const { deal, recoups = [], settlement } = input;

  if (deal.expenseCap != null && rawExpenseTotal > deal.expenseCap) {
    warnings.push(
      `Approved expenses ($${rawExpenseTotal.toLocaleString()}) exceed the $${deal.expenseCap.toLocaleString()} cap — capped at $${cappedExpenses.toLocaleString()} for settlement.`,
    );
  }

  const hospitalityCap =
    deal.hospitalityCap ?? parsedNotes.hospitalityCap ?? null;
  if (hospitalityCap != null) {
    const hospitalitySpend = approvedExpenses
      .filter((e) => e.category === "hospitality")
      .reduce((s, e) => s + e.amount, 0);
    if (hospitalitySpend > hospitalityCap) {
      warnings.push(
        `Hospitality spend ($${hospitalitySpend.toLocaleString()}) exceeds the $${hospitalityCap.toLocaleString()} rider cap — venue may be absorbing the difference.`,
      );
    }
  }

  const disputed = recoups.filter((r) => r.status === "disputed");
  for (const r of disputed) {
    warnings.push(
      `Disputed recoup: ${r.label} ($${r.amount.toLocaleString()}) — not included in total until resolved.`,
    );
  }

  if (settlement != null) {
    const signedLike = ["signed", "finalized", "paid"].includes(settlement.status);
    if (signedLike && !settlement.signoffText?.trim()) {
      warnings.push(
        `Settlement status is "${settlement.status}" but no artist sign-off text is on file.`,
      );
    }
    if (
      settlement.status === "disputed" &&
      settlement.signoffText?.trim() &&
      /\b(ok|okay|looks good|approved|fine|agreed)\b/i.test(settlement.signoffText)
    ) {
      warnings.push(
        `Status is disputed but sign-off text reads positive ("${settlement.signoffText.slice(0, 60)}${settlement.signoffText.length > 60 ? "…" : ""}") — reconcile before finalizing.`,
      );
    }
    if (
      settlement.totalToArtist != null &&
      Math.abs(settlement.totalToArtist - totalToArtist) > 0.5
    ) {
      warnings.push(
        `Logged settlement ($${settlement.totalToArtist.toLocaleString()}) differs from calculated total ($${totalToArtist.toLocaleString()}).`,
      );
    }
  }

  for (const flag of detectStaleStructuredFields(
    deal.dealNotesFreetext,
    !!deal.bonusesJson,
    parsedNotes,
  )) {
    warnings.push(flag);
  }

  return warnings;
}

function auditToSteps(
  trail: AuditTrailEntry[],
): { label: string; value: number; note?: string }[] {
  return trail.map((e) => ({
    label: e.label,
    value: e.value,
    note: e.explanation,
  }));
}

function calculateVsDeal(
  input: CalcInput,
  grossBoxOffice: number,
  totalFees: number,
  netBoxOffice: number,
): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold, recoups = [] } =
    input;

  if (deal.guaranteeAmount == null || deal.percentage == null) {
    return {
      supported: false,
      reason: "Vs deal is missing a guarantee or percentage.",
      dealType: deal.dealType,
    };
  }

  const basis = deal.percentageBasis ?? "net";
  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);
  const fillRatio =
    venueCapacity != null && venueCapacity > 0 ? tickets / venueCapacity : null;

  const approvedExpenses = expenses.filter(
    (e) => e.approved && !e.absorbedByVenue,
  );
  const rawExpenseTotal = approvedExpenses.reduce((s, e) => s + e.amount, 0);
  const cappedExpenses =
    deal.expenseCap != null
      ? Math.min(rawExpenseTotal, deal.expenseCap)
      : rawExpenseTotal;

  const parsedNotes = parseDealNotes(deal.dealNotesFreetext);
  const structuredBonuses = parseBonuses(deal);
  const { percentage: effectivePct, explanation: pctNote } = resolveVsPercentage(
    deal,
    structuredBonuses,
    parsedNotes,
    fillRatio,
  );

  const auditTrail: AuditTrailEntry[] = [];
  let step = 1;

  auditTrail.push({
    step: step++,
    label: "Gross box office",
    value: grossBoxOffice,
    explanation: "Sum of ticket sales gross",
  });

  auditTrail.push({
    step: step++,
    label: "Platform & CC fees",
    value: -totalFees,
    explanation: "Deducted from gross to reach net after fees",
  });

  auditTrail.push({
    step: step++,
    label: "Net after fees",
    value: netBoxOffice,
    explanation: `${grossBoxOffice.toLocaleString()} − ${totalFees.toLocaleString()}`,
  });

  let percentageBasisAmount: number;
  if (basis === "gross") {
    percentageBasisAmount = grossBoxOffice;
    auditTrail.push({
      step: step++,
      label: "Percentage basis (gross)",
      value: percentageBasisAmount,
      explanation: "Vs-gross deal — no expense deductions before percentage",
    });
  } else {
    auditTrail.push({
      step: step++,
      label: "Approved expenses",
      value: -cappedExpenses,
      explanation:
        deal.expenseCap != null
          ? `Passed-through expenses, capped at $${deal.expenseCap.toLocaleString()} (raw: $${rawExpenseTotal.toLocaleString()})`
          : `Passed-through expenses (${rawExpenseTotal.toLocaleString()})`,
    });
    percentageBasisAmount = netBoxOffice - cappedExpenses;
    auditTrail.push({
      step: step++,
      label: "Net after expenses",
      value: percentageBasisAmount,
      explanation: `${netBoxOffice.toLocaleString()} − ${cappedExpenses.toLocaleString()}`,
    });
  }

  const percentageAmount = percentageBasisAmount * effectivePct;
  auditTrail.push({
    step: step++,
    label: `× ${(effectivePct * 100).toFixed(0)}%`,
    value: percentageAmount,
    explanation: pctNote ?? `${(effectivePct * 100).toFixed(0)}% of ${basis}`,
  });

  const guarantee = deal.guaranteeAmount;
  const vsBase = Math.max(guarantee, percentageAmount);
  const guaranteeWon = vsBase === guarantee;

  auditTrail.push({
    step: step++,
    label: guaranteeWon ? "Guarantee (vs winner)" : "Percentage (vs winner)",
    value: vsBase,
    explanation: guaranteeWon
      ? `Guarantee $${guarantee.toLocaleString()} beats ${percentageAmount.toLocaleString()} (${(effectivePct * 100).toFixed(0)}% of ${basis})`
      : `${(effectivePct * 100).toFixed(0)}% of ${basis} (${percentageAmount.toLocaleString()}) beats guarantee $${guarantee.toLocaleString()}`,
  });

  const payableBonuses = structuredBonuses.filter((b) => !isWalkoutBonus(b));
  const noteBonusStructs = noteBonusesToStructured(parsedNotes.noteBonuses);
  const bonusResult = applyBonuses(
    [...payableBonuses, ...noteBonusStructs],
    { gross: grossBoxOffice, tickets, capacity: venueCapacity },
    { includeTierRatchet: false },
  );

  if (bonusResult.totalApplied > 0) {
    auditTrail.push({
      step: step++,
      label: "Bonuses",
      value: bonusResult.totalApplied,
      explanation: bonusResult.applied.map((b) => b.reason).join("; "),
    });
  }

  const walkout = resolveWalkoutAmount(
    grossBoxOffice,
    deal,
    parsedNotes,
    structuredBonuses,
    cappedExpenses,
  );
  if (walkout.amount > 0) {
    auditTrail.push({
      step: step++,
      label: "Walkout pot",
      value: walkout.amount,
      explanation: walkout.explanation,
    });
  }

  const subtotal = vsBase + bonusResult.totalApplied + walkout.amount;

  const agreedRecoups = recoups.filter((r) => r.status === "agreed");
  const recoupTotal = agreedRecoups.reduce((s, r) => s + r.amount, 0);
  if (recoupTotal > 0) {
    auditTrail.push({
      step: step++,
      label: "Recoups (agreed)",
      value: -recoupTotal,
      explanation: agreedRecoups.map((r) => `${r.label}: $${r.amount}`).join("; "),
    });
  }

  const totalToArtist = subtotal - recoupTotal;
  auditTrail.push({
    step: step++,
    label: "Total to artist",
    value: totalToArtist,
    explanation: "Vs base + bonuses + walkout − agreed recoups",
  });

  const warnings = buildWarnings(
    input,
    totalToArtist,
    rawExpenseTotal,
    cappedExpenses,
    approvedExpenses,
    parsedNotes,
  );

  const parts = [
    guaranteeWon ? `g'tee ${guarantee}` : `${(effectivePct * 100).toFixed(0)}% ${basis}`,
  ];
  if (bonusResult.totalApplied) parts.push(`+bonuses ${bonusResult.totalApplied}`);
  if (walkout.amount) parts.push(`+walkout ${walkout.amount}`);
  if (recoupTotal) parts.push(`−recoups ${recoupTotal}`);

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice,
    totalExpenses: cappedExpenses,
    totalToArtist,
    steps: auditToSteps(auditTrail),
    finalFormula: `${parts.join(" ")} = ${totalToArtist.toFixed(2)}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
    auditTrail,
    guaranteeWon,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  if (deal.dealType === "vs") {
    return calculateVsDeal(input, grossBoxOffice, totalFees, netBoxOffice);
  }

  // ---------- flat guarantee ----------
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. The guarantee is the floor.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }


  // ---------- percentage of gross ----------
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }
    const payout = grossBoxOffice * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps: [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(0)}%`,
          value: payout,
          note: "Percentage of gross — no expense deductions.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  const friendlyName: Record<Deal["dealType"], string> = {
    flat: "Flat guarantee",
    percentage_of_gross: "Percentage of gross",
    percentage_of_net: "Percentage of net",
    vs: "Vs deal (guarantee vs %)",
    door: "Door deal",
  };

  return {
    supported: false,
    dealType: deal.dealType,
    reason:
      `${friendlyName[deal.dealType]} deals aren't supported in the in-app tool yet. ` +
      `Power users at venues like The Crescent default to spreadsheets for these.`,
  };
}

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
  opts?: { includeTierRatchet?: boolean },
) {
  const includeTierRatchet = opts?.includeTierRatchet ?? true;
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (isWalkoutBonus(b)) {
      continue;
    }

    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      if (!includeTierRatchet) {
        notTriggered.push({
          label: b.label,
          amount: 0,
          reason: "Applied to percentage rate in vs calculation",
        });
        continue;
      }
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets need vs-deal or % of net support — not yet handled",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
