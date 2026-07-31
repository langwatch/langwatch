/**
 * The stable empty result array for a stubbed tRPC `api.useQueries`.
 *
 * Components that read annotations go through `useAnnotationsByTraceIds` ->
 * `api.useQueries`, which touches the tRPC context unconditionally — an
 * `enabled: false` guard does not spare it, so rendering under a bare
 * ChakraProvider throws "Cannot destructure property 'ssrState'". Tests that
 * never need annotation data back stub the module instead.
 *
 * The single shared constant is load-bearing, not tidiness. Real
 * @tanstack/react-query returns a REFERENTIALLY STABLE result array across
 * renders when nothing changed, and that stability carries: the hook's `data`
 * memo depends on it, which feeds consumers' own memos, which are useEffect
 * dependencies that call setState. A stub returning `chunks.map(...)` — or any
 * fresh `[]` — allocates a new array every render, so the whole memo chain
 * recomputes, the effect re-fires, setState runs, and the render loop never
 * settles (an OOM crash in a real run). Returning one constant regardless of
 * input sidesteps that without reimplementing react-query's caching.
 *
 * Import this into the `vi.mock("~/utils/api", ...)` factory rather than
 * redeclaring it, so the next person who fixes the stub fixes every copy.
 */
export const STABLE_EMPTY_QUERY_RESULTS: never[] = [];
