/**
 * Explicit shape returned by getShowById (queries.ts).
 * Drizzle spread inference can drop top-level join keys; this is the source of truth for UI.
 */

import type {
  Show,
  Artist,
  Agent,
  Agency,
  Deal,
  Settlement,
  Venue,
  TicketSale,
  Expense,
  Comp,
  Recoup,
} from "@/db/schema";

export type ShowWithRelations = {
  show: Show;
  artist: Artist | null;
  agent: Agent | null;
  agency: Agency | null;
  deal: Deal | null;
  settlement: Settlement | null;
  venue: Venue | null;
  ticketSales: TicketSale[];
  expenses: Expense[];
  comps: Comp[];
  recoups: Recoup[];
};
