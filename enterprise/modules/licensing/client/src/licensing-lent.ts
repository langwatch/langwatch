/** What licensing lends to screens it does not own, by token (ARCHITECTURE.md §10.1). */

import type { LimitType } from "@langwatch/enterprise-licensing-contract";
import { uiTokens } from "@langwatch/module";

/** A usage-against-limit row: a limit type licensing names, or a caller's label. */
export type ResourceLimitRowProps = { current: number; max?: number } & (
  | { label: string; limitType?: never }
  | { limitType: "members" | "membersLite"; label?: never }
);

export const ResourceLimitRowToken =
  uiTokens("licensing").component<ResourceLimitRowProps>("resourceLimitRow");

/** The seat-quantity confirmation the upgrade modal shows with its proration preview. */
export type UpgradeModalSeatsRequest = {
  organizationId: string;
  currentSeats: number;
  newSeats: number;
  /** The instant the on-screen quote was priced; undefined prices the confirm when it runs. */
  onConfirm: (quotedAt?: number) => Promise<void>;
};

/** What a screen calls to open licensing's upgrade modal. */
export type UpgradeModalActions = {
  open(limitType: LimitType, current: number, max: number): void;
  openSeats(request: UpgradeModalSeatsRequest): void;
  openLiteMemberRestriction(request: { resource?: string }): void;
};

export const UpgradeModalToken = uiTokens("licensing").hooks<UpgradeModalActions>("upgradeModal");
