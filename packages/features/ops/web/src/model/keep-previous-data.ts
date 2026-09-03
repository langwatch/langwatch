/**
 * Hold the previous page's rows on screen while the next page loads.
 *
 * React Query ships this exact function as `keepPreviousData`, and the payload
 * listing passes it as `placeholderData`. Importing it would mean importing
 * `@tanstack/react-query` into a screen closure, which ADR-004 seals off — a
 * feature package states what it needs and the application supplies the
 * transport. The function is the identity, so restating it costs nothing and
 * keeps the call site the line it was.
 */
export function keepPreviousData<TData>(previousData: TData): TData {
  return previousData;
}
