/**
 * Whether an address is the Trace Explorer's own.
 */

const TRACE_EXPLORER_PATH = /^\/[^/]+\/traces(?:\/|$)/;

export function isTraceExplorerPath(pathname: string): boolean {
  return TRACE_EXPLORER_PATH.test(pathname);
}
