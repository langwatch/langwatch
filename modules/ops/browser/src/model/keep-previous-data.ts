/** React Query's keepPreviousData (identity function). Restated to avoid importing
 * @tanstack/react-query into screen closure (ADR-004). */
export function keepPreviousData<TData>(previousData: TData): TData {
  return previousData;
}
