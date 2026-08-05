/**
 * The context manager that lets an in-flight navigation parent the work it
 * causes.
 *
 * `StackContextManager` only keeps context across synchronous calls: it has no
 * way to follow an `await`, a `setTimeout` or a React commit. A navigation is
 * all three — the router resolves a lazy route, React mounts the page, and the
 * page's queries dispatch fetches from effects. By the time those fetches run,
 * the stack that started the navigation is long gone, so the fetch spans would
 * root their own traces and the navigation span would sit alone with no
 * children.
 *
 * Rather than adopt zone.js (a global patch of every async primitive, rejected
 * in ADR-058) this narrows the problem to the one case that matters. A
 * navigation is a singular, page-wide, explicitly delimited state — the tab
 * navigates to one place at a time, and the router says when that starts and
 * ends. So while a navigation is in flight it is published as an *ambient*
 * context: spans that would otherwise have no parent at all take it instead.
 *
 * This is deliberately weaker than real async propagation. It cannot tell the
 * difference between a fetch the navigation caused and an unrelated background
 * poll that happened to fire during it, so during a navigation both are
 * attributed to it. That over-attribution is bounded by the navigation's own
 * duration and is worth the trade: the alternative is a navigation span with no
 * children, which answers nothing.
 *
 * See ADR-058.
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
   * The active context, falling back to the in-flight navigation.
   *
   * Only spans that would otherwise be roots are affected: anything with a
   * span already on the context keeps the parent it has, so synchronous
   * nesting behaves exactly as it does without this class.
   */
  override active(): Context {
    const active = super.active();
    if (trace.getSpanContext(active)) return active;
    return ambient ?? active;
  }
}
