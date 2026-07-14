import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * quiet. Used to throttle the server-side facet search: a per-keystroke
 * `facetValues` prefix scan over a high-cardinality facet is a real ClickHouse
 * round-trip, so the network query reads this debounced value while the
 * client-side substring filter stays on the live value for instant local
 * feedback.
 *
 * No generic value-debounce hook existed under `src/` (only the purpose-built
 * `useDebouncedFilterCommit` / `useDebouncedTextarea`), so this is the small
 * shared primitive for "debounce an already-controlled value".
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
