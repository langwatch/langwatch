/** What licensing lends to screens it does not own, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** A usage-against-limit row: a limit type licensing names, or a caller's label. */
export type ResourceLimitRowProps = { current: number; max?: number } & (
  | { label: string; limitType?: never }
  | { limitType: "members" | "membersLite"; label?: never }
);

export const ResourceLimitRowToken =
  uiTokens("licensing").component<ResourceLimitRowProps>("resourceLimitRow");
