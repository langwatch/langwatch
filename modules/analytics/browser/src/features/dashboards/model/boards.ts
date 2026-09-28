/**
 * The boards the Dashboards area lists: code-defined ones (the Agent Flight
 * Deck, which has no database row and cannot be edited) and the member's own,
 * stored as `Dashboard` rows. Addresses are built here and nowhere else.
 */

import { FLIGHT_DECK_DASHBOARD_ID } from "@langwatch/dashboard-contract";
import { z } from "zod";

/** A board shipped in code rather than stored. */
export const codeDefinedBoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  readOnly: z.literal(true),
});

export type CodeDefinedBoard = z.infer<typeof codeDefinedBoardSchema>;

export const FLIGHT_DECK: CodeDefinedBoard = {
  id: FLIGHT_DECK_DASHBOARD_ID,
  name: "Agent Flight Deck",
  description: "Traffic, quality, latency and cost on one timeline.",
  isDefault: true,
  readOnly: true,
};

/** The address of the area, or of one board in it. */
export function dashboardsPath({
  projectSlug,
  dashboardId,
}: {
  projectSlug: string;
  dashboardId?: string;
}): string {
  const area = `/${projectSlug}/dashboards`;
  return dashboardId === void 0 ? area : `${area}/${encodeURIComponent(dashboardId)}`;
}

/**
 * The board `/[project]/dashboards` opens. No member default is stored yet,
 * so it is always the Flight Deck.
 */
export function landingBoardId(): string {
  return FLIGHT_DECK.id;
}

/** The name a board gets when created from the sidebar, before the member renames it. */
export function untitledBoardName({ existingCount }: { existingCount: number }): string {
  return `Untitled dashboard ${existingCount + 1}`;
}
