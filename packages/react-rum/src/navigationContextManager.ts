/**
 * Lets an in-flight navigation parent the work it causes.
 * `StackContextManager` can't follow an `await`/React commit, so instead of
 * zone.js (ADR-058) a navigation publishes *ambient* context while in flight.
 */

import { type Context, trace } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";

let ambient: Context | undefined;

/**
 * Publishes `context` as the parent for spans started with nothing else
 * active. Replaces any previous ambient context — a second navigation
 * supersedes the first.
 */
export function setAmbientContext(context: Context): void {
  ambient = context;
}

/**
 * Withdraws `context` if it is still the published one. Passing the context
 * back, rather than clearing unconditionally, keeps a late teardown from
 * wiping the ambient context a newer navigation has since installed.
 */
export function clearAmbientContext(context: Context): void {
  if (ambient === context) ambient = void 0;
}

/** Test seam: drops the ambient context whatever it is. */
export function resetAmbientContextForTesting(): void {
  ambient = void 0;
}

export class NavigationContextManager extends StackContextManager {
  /**
   * The active context, falling back to the in-flight navigation. Only spans
   * that would otherwise be roots are affected — one already on the context
   * keeps its parent, so synchronous nesting behaves exactly as without this.
   */
  override active(): Context {
    const active = super.active();
    if (trace.getSpanContext(active)) return active;
    return ambient ?? active;
  }
}
