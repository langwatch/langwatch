/**
 * The `~/utils/api` boundary mock the Langy panel suites share.
 *
 * Every suite that renders `LangySidecar` has to answer the whole tRPC surface
 * the panel touches, not just the procedure under test: the header's permission
 * menus, the model picker, the GitHub connect card and the freshness hook each
 * pull their own queries. Enumerating them per suite meant the same ~50 lines
 * were pasted into every file, so the day the panel added a query, five copies
 * had to be found and edited — and the ones that were missed failed in a way
 * that looked like a panel bug.
 *
 * The shape here is the INERT default: any router a suite has not spoken for
 * answers a settled-idle query, a no-op mutation or a no-op subscription. Each
 * suite then declares only the procedures it actually cares about, and
 * {@link withFallback} lets those win.
 *
 * Import it from INSIDE the `vi.mock` factory (`await import(...)`), never at
 * the top of the test file: `vi.mock` is hoisted above the imports, so a
 * top-level binding is still in its temporal dead zone when the factory runs.
 *
 * Not a `*.test.ts` file, so vitest treats it as a plain module rather than a
 * suite with no tests.
 */

/** A query that has settled with nothing — no data, no error, not loading. */
export const idleQuery = () => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isFetched: true,
  isError: false,
  error: null,
  refetch: () => Promise.resolve(),
});

/** A mutation that accepts a call and does nothing with it. */
export const noopMutation = () => ({
  mutate: () => undefined,
  mutateAsync: () => Promise.resolve(),
  isPending: false,
});

/**
 * Every router a suite does not mock explicitly, at any depth: reading any
 * property gives back the proxy again, so `api.anything.nested.useQuery()`
 * resolves to the inert query rather than throwing at render.
 */
export const routerProxy: unknown = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === "useQuery" || prop === "useInfiniteQuery") return idleQuery;
      if (prop === "useMutation") return noopMutation;
      if (prop === "useSubscription") return () => undefined;
      return routerProxy;
    },
  },
);

/**
 * The `modelProvider` router as a panel suite needs it, rather than as the
 * suite's subject: a resolved Langy model (without one the sidebar draws the
 * inline model-setup screen over the panel), an empty provider list, and the
 * two default-model mutations the make-default dialog holds at render. A suite
 * that IS about one of these passes its own value for that key.
 */
export const modelProviderRouter = (explicit: Record<string, unknown> = {}) => ({
  getResolvedDefault: {
    useQuery: () => ({
      data: { model: "openai/gpt-5-mini" },
      isLoading: false,
    }),
  },
  listAllForProjectForFrontend: {
    useQuery: () => ({ data: [], isLoading: false }),
  },
  setRoleAssignmentForScope: { useMutation: noopMutation },
  setFeatureOverrideForScope: { useMutation: noopMutation },
  ...explicit,
});

/** Explicitly declared procedures win; anything else on the router is inert. */
export const withFallback = (explicit: Record<string, unknown>) =>
  new Proxy(explicit, {
    get: (target, prop) =>
      prop in target ? target[prop as string] : (routerProxy as never),
  });

/**
 * The React Query utils tree behind `useUtils()` / `useContext()`.
 *
 * Nothing here does real work by default; it exists so `useLangyFreshness`'s
 * SSE handler and the conversation-delete path can reference these without
 * throwing at render. A suite that asserts on a cache invalidation passes
 * `onListInvalidate` and observes it.
 */
export const createTrpcUtils = ({
  onListInvalidate,
}: {
  onListInvalidate?: (input?: unknown) => void;
} = {}) => ({
  langy: {
    list: {
      getData: () => undefined,
      setData: () => undefined,
      getInfiniteData: () => undefined,
      setInfiniteData: () => undefined,
      cancel: () => Promise.resolve(),
      invalidate: (input?: unknown) => {
        onListInvalidate?.(input);
        return Promise.resolve();
      },
    },
    messages: { invalidate: () => Promise.resolve() },
    detail: { setData: () => undefined },
  },
  github: { getConnectionStatus: { invalidate: () => Promise.resolve() } },
});
