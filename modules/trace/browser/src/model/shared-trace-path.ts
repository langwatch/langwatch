/**
 * Whether an address is a public share page, which draws the trace surface in place.
 */

const SHARED_TRACE_PATH = /^\/share\/[^/]+\/?$/;

export function isSharedTracePath(pathname: string): boolean {
  return SHARED_TRACE_PATH.test(pathname);
}
