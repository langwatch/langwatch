/**
 * The `~/utils/api` boundary mock the Langy panel suites share.
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
 * The `modelProvider` router as a panel suite needs it, rather than as the suite's subject: a resolved Langy
 * model (without one the sidebar draws the inline model-setup screen over the panel), an empty provider list, and
 * the two default-model mutations the make-default dialog holds at render.
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
    get: (target, prop) => (prop in target ? target[prop as string] : (routerProxy as never)),
  });

/**
 * The React Query utils tree behind `useUtils()` / `useContext()`.
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
