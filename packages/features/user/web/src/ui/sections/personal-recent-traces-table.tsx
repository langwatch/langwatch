/**
 * The "Recent activity" card on `/me`.
 *
 * A PLACEHOLDER, and this is the one thing the personal-workspace move gives
 * up. In `platform/app` this card rendered the trace explorer's own table
 * scoped to the reader's personal project: `TraceTableShell`, `RegistryRow`,
 * `traceRegistry`, `buildTraceColumns`, `TraceStatisticsProvider`,
 * `mapTraceListPayload` and the `TraceListItem` type — six deep imports into
 * `features/traces-v2`, none of which is a package. Copying that subtree into
 * this package would fork the trace explorer's table, which is the one outcome
 * worth avoiding: the columns, the density, the addons and the row chrome are
 * the explorer's to change, and a second copy would drift from the first the
 * week after it landed.
 *
 * `@langwatch/trace-web` was the alternative and does not fit: it publishes the
 * explorer's stores and formatters, not its table. So until a trace table
 * surface exists there, this card renders the state the table itself rendered
 * when the project had nothing — the integrate pitch, with its three offers
 * intact — and never the ten rows.
 *
 * WHAT A READER LOSES, stated plainly: the ten most recent traces on `/me`, and
 * the click that deep-linked one into the explorer. Everything the pitch offers
 * still works, and `/`<project>`/traces` still lists the same traces in full.
 * Recorded in `dev/docs/plans/ui-family-move-manifests.md`; it comes back with
 * a `@langwatch/trace-web` table surface, at which point this file is the one
 * that changes.
 */

import { PersonalTracesEmptyState } from "../blocks/personal-traces-empty-state";

export function PersonalRecentTracesTable({
  projectSlug,
}: {
  /** Kept so the API-key offer can deep-link once a project is resolved. */
  projectSlug: string;
}) {
  return <PersonalTracesEmptyState projectSlug={projectSlug} />;
}
