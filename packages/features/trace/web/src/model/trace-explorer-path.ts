/**
 * Whether an address is the Trace Explorer's own.
 *
 * The Trace Explorer page mounts its own copy of the drawer shell, straight
 * off the drawer store, so the global mount has to stand down there or the
 * reader gets two stacked drawers over one trace.
 *
 * TWO SPELLINGS REACH THIS AND BOTH MEAN THE EXPLORER. `platform/app` asked
 * Next's dynamic-route TEMPLATE, so the answer was a prefix match on
 * `/[project]/traces`. `apps/ui` answers the same port from react-router's
 * RESOLVED pathname — `/my-project/traces` — and a template-only match reads
 * that as somewhere else entirely, which is the one answer that double-mounts.
 * One project segment, whichever way it is written, then `traces`.
 */

const TRACE_EXPLORER_PATH = /^\/[^/]+\/traces(?:\/|$)/;

export function isTraceExplorerPath(pathname: string): boolean {
  return TRACE_EXPLORER_PATH.test(pathname);
}
