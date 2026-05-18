// lib/parseDealNotes.ts

export type ParsedNoteBonus = {
    type: "gross_threshold" | "attendance_threshold" | "sellout";
    label: string;
    amount: number;
    threshold: number;
  };
  
  export interface ParsedDealModifiers {
    walkout: {
      kind: "threshold" | "breakeven";
      threshold: number;
    } | null;
    ratchet: {
      basePercent: number;
      escalatedPercent: number;
      capacityThreshold: number;
    } | null;
    hospitalityCap: number | null;
    noteBonuses: ParsedNoteBonus[];
    warnings: string[];
  }
  
  export function parseDealNotes(
    freetext: string | null,
  ): ParsedDealModifiers {
    const result: ParsedDealModifiers = {
      walkout: null,
      ratchet: null,
      hospitalityCap: null,
      noteBonuses: [],
      warnings: [],
    };
  
    if (!freetext) return result;
  
    // --- WALKOUT ---
    const walkoutMatch = freetext.match(
      /[Ww]alkout\s+pot:\s*100%\s+of\s+gross\s+above\s+\$?([\d,]+)/
    );
    if (walkoutMatch) {
      result.walkout = {
        kind: "threshold",
        threshold: parseFloat(walkoutMatch[1].replace(/,/g, "")),
      };
    } else if (/walkout\s+above\s+breakeven/i.test(freetext)) {
      result.walkout = { kind: "breakeven", threshold: 0 };
    }
  
    // --- RATCHET ---
    const ratchetMatch = freetext.match(
      /[Rr]atchet[s]?[:\s]+(\d+)%\s+to\s+(\d+)%\s+over\s+(\d+)%/
    );
    if (ratchetMatch) {
      result.ratchet = {
        basePercent: parseInt(ratchetMatch[1]) / 100,
        escalatedPercent: parseInt(ratchetMatch[2]) / 100,
        capacityThreshold: parseInt(ratchetMatch[3]) / 100,
      };
    } else {
      const ratchetAlt = freetext.match(
        /ratchets?\s+to\s+(\d+)%\s+over\s+(\d+)%\s+capacity/
      );
      if (ratchetAlt) {
        result.ratchet = {
          basePercent: NaN, // caller should fall back to deal.percentage
          escalatedPercent: parseInt(ratchetAlt[1]) / 100,
          capacityThreshold: parseInt(ratchetAlt[2]) / 100,
        };
      }
    }
  
    // --- BONUSES FROM NOTES ---
    // "+$800 if gross > $21,000"
    const grossBonuses = [
      ...freetext.matchAll(/\+\$?([\d,]+)\s+if\s+gross\s*>\s*\$?([\d,]+)/gi),
    ];
    for (const m of grossBonuses) {
      const amt = parseFloat(m[1].replace(/,/g, ""));
      const thresh = parseFloat(m[2].replace(/,/g, ""));
      result.noteBonuses.push({
        type: "gross_threshold",
        label: `+$${amt.toLocaleString()} if gross > $${thresh.toLocaleString()}`,
        amount: amt,
        threshold: thresh,
      });
    }
  
    // "+$300 if attendance > 585"
    const attendBonuses = [
      ...freetext.matchAll(/\+\$?([\d,]+)\s+if\s+attendance\s*>\s*([\d,]+)/gi),
    ];
    for (const m of attendBonuses) {
      const amt = parseFloat(m[1].replace(/,/g, ""));
      const thresh = parseFloat(m[2].replace(/,/g, ""));
      result.noteBonuses.push({
        type: "attendance_threshold",
        label: `+$${amt.toLocaleString()} if attendance > ${thresh}`,
        amount: amt,
        threshold: thresh,
      });
    }
  
    // "+$1,400 on sellout"
    const selloutBonus = freetext.match(/\+\$?([\d,]+)\s+on\s+sellout/i);
    if (selloutBonus) {
      const amt = parseFloat(selloutBonus[1].replace(/,/g, ""));
      result.noteBonuses.push({
        type: "sellout",
        label: `+$${amt.toLocaleString()} on sellout`,
        amount: amt,
        threshold: 0,
      });
    }
  
    // --- HOSPITALITY CAP ---
    const hospMatch = freetext.match(
      /[Hh]osp(?:itality)?\s+(?:cap\s*)?\$?([\d,]+)/
    );
    if (hospMatch) {
      result.hospitalityCap = parseFloat(hospMatch[1].replace(/,/g, ""));
    }
  
    // --- WARNINGS ---
    if (/structured field still reflects|confirm before settlement/i.test(freetext)) {
      result.warnings.push(
        "Deal notes indicate structured fields may be stale — verify terms before settling"
      );
    }
    if (/[Rr]enegotiated|[Uu]pdated.*before show|was \d+\/\d+/.test(freetext)) {
      result.warnings.push(
        "Deal was renegotiated — confirm current terms match what was agreed"
      );
    }
    if (/recoup.*against gross|recoup.*ambiguous|recoup.*disputed/i.test(freetext)) {
      result.warnings.push(
        "Marketing recoup language is ambiguous — clarify if inside or outside expense cap"
      );
    }
  
    return result;
  }
  
  /**
   * Detect when structured fields might be stale relative to the prose notes.
   * Called from buildWarnings in dealMath.ts.
   */
  export function detectStaleStructuredFields(
    freetext: string | null,
    hasBonusesJson: boolean,
    parsed: ParsedDealModifiers,
  ): string[] {
    const flags: string[] = [];
  
    if (!freetext) return flags;
  
    // Notes mention bonuses but bonuses_json is empty
    if (!hasBonusesJson && parsed.noteBonuses.length > 0) {
      flags.push(
        `Deal notes reference ${parsed.noteBonuses.length} bonus(es) not captured in structured fields — verify before settling.`
      );
    }
  
    // Notes say "see email thread" for bonuses but structured bonuses exist
    if (
      /bonus.*see email|per the deal memo/i.test(freetext) &&
      hasBonusesJson
    ) {
      flags.push(
        "Deal notes reference external bonus terms ('see email thread') — confirm structured bonuses match the agreed deal."
      );
    }
  
    // Notes mention a ratchet but no structured ratchet
    if (parsed.ratchet && /was \d+\/\d+/.test(freetext)) {
      flags.push(
        "Deal notes suggest renegotiated split — structured percentage may reflect the original, not the current terms."
      );
    }
  
    return flags;
  }