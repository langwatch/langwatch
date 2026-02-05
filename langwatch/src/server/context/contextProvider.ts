/**
 * Context provider registry for the logger.
 *
 * This module provides a decoupled way for the logger to access request context
 * without creating circular dependencies. The asyncContext module registers
 * its getLogContext function here, and the logger calls getContext().
 */

type ContextGetter = () => Record<string, string | null>;

let contextGetter: ContextGetter | null = null;

/**
 * Registers the context getter function.
 * Called by asyncContext during module initialization.
 */
export function registerContextProvider(getter: ContextGetter): void {
  contextGetter = getter;
}

/**
 * Gets the current request context for logging.
 * Returns an empty object if no context provider is registered.
 */
export function getContext(): Record<string, string | null> {
  if (contextGetter) {
    return contextGetter();
  }
  return {};
}
