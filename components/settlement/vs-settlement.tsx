"use client";

import { useMemo, useState } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import {
  calculateSettlement,
  type SettlementCalculation,
  type SettlementCalcMeta,
} from "@/lib/dealMath";
import { parseDealNotes } from "@/lib/parseDealNotes";
import { formatMoney } from "@/lib/format";
import type {
  Deal,
  Expense,
  TicketSale,
  Recoup,
  Settlement,
  Comp,
} from "@/db/schema";

const CRESCENT_CAPACITY = 650;

const EXPENSE_LABELS: Record<Expense["category"], string> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

type AuditLine = {
  id: string;
  label: string;
  value: number;
  explanation: string;
  details?: string;
  highlight?: "guarantee-win" | "percentage-win" | "total" | "warning";
};

export type VsSettlementProps = {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  recoups: Recoup[];
  comps: Comp[];
  settlement: Settlement | null;
  venueCapacity?: number;
};

function formatAuditValue(value: number): string {
  if (value < 0) {
    return `−${formatMoney(Math.abs(value))}`;
  }
  return formatMoney(value);
}

function buildAuditLines(
  calc: Extract<SettlementCalculation, { supported: true }>,
  props: VsSettlementProps,
  parsed: ReturnType<typeof parseDealNotes>,
): AuditLine[] {
  const { ticketSales, expenses, recoups, deal } = props;
  const basis = deal.percentageBasis ?? "net";
  const approved = expenses.filter((e) => e.approved && !e.absorbedByVenue);
  const rawExpenseTotal = approved.reduce((s, e) => s + e.amount, 0);
  const capped =
    deal.expenseCap != null
      ? Math.min(rawExpenseTotal, deal.expenseCap)
      : rawExpenseTotal;

  const ticketDetail = ticketSales
    .map(
      (t) =>
        `${t.qty} tickets · gross ${formatMoney(t.gross)} · fees ${formatMoney(t.fees)}`,
    )
    .join("\n");

  const compDetail =
    props.comps.length > 0
      ? props.comps
          .map(
            (c) =>
              `${c.count} ${c.category} @ ${formatMoney(c.faceValue)} face${c.countsTowardGross ? " · counts toward gross" : ""}`,
          )
          .join("\n")
      : "";

  const lines: AuditLine[] = [
    {
      id: "gross",
      label: "Gross box office",
      value: calc.grossBoxOffice,
      explanation: "Sum of ticket sales gross",
      details:
        [ticketDetail, compDetail && `Comps:\n${compDetail}`]
          .filter(Boolean)
          .join("\n\n") || "No ticket sale rows on file.",
    },
    {
      id: "fees",
      label: "Platform fees",
      value: -(calc.grossBoxOffice - calc.netBoxOffice),
      explanation: "CC and platform fees deducted from gross",
      details: ticketSales
        .map((t) => `Fees on ${formatMoney(t.gross)} gross: ${formatMoney(t.fees)}`)
        .join("\n"),
    },
    {
      id: "net-fees",
      label: "Net after fees",
      value: calc.netBoxOffice,
      explanation: "Gross minus platform fees",
    },
  ];

  if (basis === "net") {
    const byCategory = new Map<string, number>();
    for (const e of approved) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }

    const expenseDetails = [...byCategory.entries()]
      .map(
        ([cat, amt]) =>
          `${EXPENSE_LABELS[cat as Expense["category"]] ?? cat}: ${formatMoney(amt)}`,
      )
      .join("\n");

    for (const [cat, amt] of byCategory) {
      const row = approved.find((e) => e.category === cat);
      lines.push({
        id: `exp-${cat}`,
        label: EXPENSE_LABELS[cat as Expense["category"]] ?? cat,
        value: -amt,
        explanation: row?.description ?? "Passed through to settlement",
        details: row?.description
          ? `${cat} · ${row.description}`
          : `Approved ${cat} expense`,
      });
    }

    if (deal.expenseCap != null && rawExpenseTotal > deal.expenseCap) {
      lines.push({
        id: "exp-cap",
        label: "Expense cap adjustment",
        value: capped - rawExpenseTotal,
        explanation: `Raw ${formatMoney(rawExpenseTotal)} capped at ${formatMoney(deal.expenseCap)}`,
        highlight: "warning",
      });
    }

    lines.push({
      id: "net-expenses",
      label: "Net after expenses",
      value: calc.netBoxOffice - capped,
      explanation: `Net after fees minus ${formatMoney(capped)} in passed-through expenses`,
      details: expenseDetails || "No approved expenses entered.",
    });
  } else {
    lines.push({
      id: "gross-basis",
      label: "Percentage basis (gross)",
      value: calc.grossBoxOffice,
      explanation: "Vs-gross — no expense deductions before percentage",
    });
  }

  const pctStep = calc.auditTrail?.find((e) => e.label.startsWith("×"));
  const pctAmount = pctStep?.value ?? 0;
  const guarantee = deal.guaranteeAmount ?? 0;
  const effectivePct = pctStep?.label.match(/×\s*(\d+)%/)?.[1] ?? String((deal.percentage ?? 0) * 100);

  lines.push({
    id: "artist-share",
    label: `Artist share (${effectivePct}% of ${basis})`,
    value: pctAmount,
    explanation: pctStep?.explanation ?? `${effectivePct}% × ${basis} basis`,
    details: `Guarantee on deal: ${formatMoney(guarantee)}\nPercentage amount: ${formatMoney(pctAmount)}`,
  });

  lines.push({
    id: "vs-winner",
    label: calc.guaranteeWon ? "Guarantee wins (vs)" : "Percentage wins (vs)",
    value: Math.max(guarantee, pctAmount),
    explanation: calc.guaranteeWon
      ? `Guarantee ${formatMoney(guarantee)} is higher than the percentage side`
      : `Percentage ${formatMoney(pctAmount)} beats the ${formatMoney(guarantee)} guarantee`,
    highlight: calc.guaranteeWon ? "guarantee-win" : "percentage-win",
  });

  const walkoutStep = calc.auditTrail?.find((e) => e.label === "Walkout pot");
  if (walkoutStep && walkoutStep.value > 0) {
    lines.push({
      id: "walkout",
      label: "Walkout pot",
      value: walkoutStep.value,
      explanation: walkoutStep.explanation,
      details: parsed.walkout
        ? parsed.walkout.kind === "threshold"
          ? `100% of gross above ${formatMoney(parsed.walkout.threshold)}`
          : "Incremental gross above breakeven (guarantee + expenses)"
        : "From deal notes or bonuses_json",
    });
  }

  for (const b of calc.bonusesApplied) {
    lines.push({
      id: `bonus-${b.label}`,
      label: b.label,
      value: b.amount,
      explanation: b.reason,
    });
  }

  for (const r of recoups.filter((x) => x.status === "agreed")) {
    lines.push({
      id: `recoup-${r.id}`,
      label: `Recoup · ${r.label}`,
      value: -r.amount,
      explanation: "Agreed recoup — deducted from artist total",
    });
  }

  for (const r of recoups.filter((x) => x.status === "disputed")) {
    lines.push({
      id: `recoup-disputed-${r.id}`,
      label: `Recoup (disputed) · ${r.label}`,
      value: 0,
      explanation: `${formatMoney(r.amount)} contested — not deducted in this total`,
      highlight: "warning",
      details:
        "Resolve with the agent before finalizing. Disputed recoups often trace to ambiguous deal email language.",
    });
  }

  lines.push({
    id: "total",
    label: "Total to artist",
    value: calc.totalToArtist,
    explanation: calc.finalFormula,
    highlight: "total",
  });

  return lines;
}

function AuditLineRow({ line }: { line: AuditLine }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(line.details?.trim());

  const rowClass = (() => {
    if (line.highlight === "total") return "bg-brand-50/50 -mx-1 px-1 rounded-md";
    if (line.highlight === "guarantee-win" || line.highlight === "percentage-win")
      return "bg-brand-50/30 ring-1 ring-brand-200/60 -mx-1 px-1 rounded-md";
    if (line.highlight === "warning") return "bg-amber-50/40 -mx-1 px-1 rounded-md";
    return "";
  })();

  return (
    <div className={rowClass}>
      <div className="flex items-start gap-2 py-2.5">
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-0.5 shrink-0 text-ink-400 hover:text-ink-700 transition-colors"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} details for ${line.label}`}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] text-ink-900 font-medium leading-tight">
              {line.label}
            </div>
            <div className="text-[11.5px] text-ink-400 mt-0.5 leading-snug">
              {line.explanation}
            </div>
          </div>
          <div
            className={`text-[13.5px] font-mono tabular shrink-0 ${
              line.highlight === "total"
                ? "font-semibold text-ink-900 text-[15px]"
                : line.value < 0
                  ? "text-ink-600"
                  : "text-ink-900"
            }`}
          >
            {formatAuditValue(line.value)}
          </div>
        </div>
      </div>
      {hasDetails && open && (
        <pre className="ml-6 mb-2 text-[11px] text-ink-500 font-mono whitespace-pre-wrap leading-relaxed bg-canvas-soft rounded-md px-3 py-2 ring-1 ring-ink-200/50">
          {line.details}
        </pre>
      )}
    </div>
  );
}

export function VsSettlement(props: VsSettlementProps) {
  const { deal, settlement, ticketSales, expenses, recoups } = props;
  const venueCapacity = props.venueCapacity ?? CRESCENT_CAPACITY;

  const parsed = useMemo(
    () => parseDealNotes(deal.dealNotesFreetext),
    [deal.dealNotesFreetext],
  );

  const settlementMeta: SettlementCalcMeta | null = useMemo(
    () =>
      settlement
        ? {
            status: settlement.status,
            signoffText: settlement.signoffText,
            totalToArtist: settlement.totalToArtist,
          }
        : null,
    [settlement],
  );

  const calc = useMemo(
    () =>
      calculateSettlement({
        deal,
        ticketSales,
        expenses,
        recoups,
        venueCapacity,
        settlement: settlementMeta,
      }),
    [deal, ticketSales, expenses, recoups, settlementMeta, venueCapacity],
  );

  const auditLines = useMemo(() => {
    if (!calc.supported) return [];
    return buildAuditLines(calc, props, parsed);
  }, [calc, props, parsed]);

  const hospitalityCap = deal.hospitalityCap ?? parsed.hospitalityCap;
  const ratchetBase =
    parsed.ratchet && !Number.isNaN(parsed.ratchet.basePercent)
      ? parsed.ratchet.basePercent
      : (deal.percentage ?? 0);

  if (!calc.supported) {
    return (
      <Card accent="amber">
        <CardContent className="py-8">
          <p className="text-[13px] text-ink-700 leading-relaxed">{calc.reason}</p>
          {deal.dealNotesFreetext && (
            <div className="mt-4 text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              {deal.dealNotesFreetext}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {calc.warnings && calc.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-800 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-amber-900">
              Settlement flags
            </div>
            <ul className="text-[12.5px] text-ink-600 mt-2 space-y-1.5 leading-relaxed list-disc pl-4">
              {calc.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="text-center py-10 mb-2">
        <div className="eyebrow text-[10px] text-ink-400 mb-3">Total to artist</div>
        <div
          className="text-[72px] font-mono tabular font-bold text-ink-900 leading-none"
          style={{ letterSpacing: "-0.03em" }}
        >
          {formatMoney(calc.totalToArtist)}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <PlainBadge variant="brand">Vs deal</PlainBadge>
          {calc.guaranteeWon ? (
            <PlainBadge variant="default">Guarantee won</PlainBadge>
          ) : (
            <PlainBadge variant="brand">
              {((deal.percentage ?? 0) * 100).toFixed(0)}% of{" "}
              {deal.percentageBasis ?? "net"} won
            </PlainBadge>
          )}
          {settlement?.status === "disputed" && (
            <PlainBadge variant="rose">Disputed</PlainBadge>
          )}
        </div>
        {settlement?.totalToArtist != null &&
          Math.abs(settlement.totalToArtist - calc.totalToArtist) > 0.5 && (
            <p className="text-[12px] text-ink-400 mt-2">
              Logged at{" "}
              <span className="font-mono tabular text-ink-600">
                {formatMoney(settlement.totalToArtist)}
              </span>
            </p>
          )}
      </div>

      <Card accent="brand">
        <CardHeader>
          <div>
            <CardTitle>Settlement audit trail</CardTitle>
            <CardDescription className="font-mono text-[12px]">
              {calc.finalFormula}
            </CardDescription>
          </div>
          <div className="text-right text-[11px] text-ink-400 max-w-[200px]">
            {ticketSales.reduce((s, t) => s + t.qty, 0)} sold · cap {venueCapacity}
            {parsed.ratchet && " · ratchet"}
            {parsed.walkout && " · walkout"}
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-ink-100/80">
          {auditLines.map((line) => (
            <AuditLineRow key={line.id} line={line} />
          ))}
        </CardContent>
      </Card>

      {(parsed.walkout || parsed.ratchet || hospitalityCap != null) && (
        <Card>
          <CardHeader>
            <CardTitle>Parsed from deal notes</CardTitle>
            <CardDescription>
              Terms extracted from free text — Mariana&apos;s source of truth
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12.5px]">
            {hospitalityCap != null && (
              <div>
                <div className="eyebrow text-[10px] text-ink-500 mb-1">
                  Hospitality cap
                </div>
                <div className="font-mono tabular">{formatMoney(hospitalityCap)}</div>
              </div>
            )}
            {parsed.walkout && (
              <div>
                <div className="eyebrow text-[10px] text-ink-500 mb-1">Walkout</div>
                <div className="text-ink-800">
                  {parsed.walkout.kind === "threshold"
                    ? `100% above ${formatMoney(parsed.walkout.threshold)} gross`
                    : "Above breakeven"}
                </div>
              </div>
            )}
            {parsed.ratchet && (
              <div>
                <div className="eyebrow text-[10px] text-ink-500 mb-1">Ratchet</div>
                <div className="text-ink-800">
                  {(ratchetBase * 100).toFixed(0)}% →{" "}
                  {(parsed.ratchet.escalatedPercent * 100).toFixed(0)}% over{" "}
                  {(parsed.ratchet.capacityThreshold * 100).toFixed(0)}% sold
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {calc.bonusesNotTriggered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bonuses not triggered</CardTitle>
            <CardDescription>
              On the deal but didn&apos;t hit tonight — useful when the agent asks
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-ink-100/80">
            {calc.bonusesNotTriggered.map((b, i) => (
              <div
                key={i}
                className="py-3 flex items-baseline justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-ink-600">{b.label}</div>
                  <div className="text-[11.5px] text-ink-400 mt-0.5">
                    {b.reason}
                  </div>
                </div>
                <div className="text-[12.5px] text-ink-300 font-mono tabular line-through">
                  {formatMoney(b.amount)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
