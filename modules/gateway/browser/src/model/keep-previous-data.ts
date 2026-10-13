/** Avoids importing @tanstack/react-query into screens. */
export function keepPreviousData<TData>(previousData: TData): TData {
  return previousData;
}
