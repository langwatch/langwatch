// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A fail-fast double of the governance tRPC binding for the kill switch suites. A test answers
 * each procedure it reaches; any other one throws by name, at render for a query and at the call
 * for a mutation (also kept in `unconfigured`, since a caller may catch it and only toast).
 */
import { useEffect, useRef, useState } from "react";

type Handler = (input: unknown) => unknown;

export const trpcDouble = {
  queries: new Map<string, Handler>(),
  mutations: new Map<string, Handler>(),
  calls: [] as { procedure: string; input: unknown }[],
  reads: [] as string[],
  invalidated: [] as string[],
  unconfigured: [] as string[],
  mounted: new Map<string, Set<() => Promise<unknown>>>(),
};

export function resetTrpcDouble() {
  trpcDouble.queries.clear();
  trpcDouble.mutations.clear();
  trpcDouble.calls = [];
  trpcDouble.reads = [];
  trpcDouble.invalidated = [];
  trpcDouble.unconfigured = [];
  trpcDouble.mounted.clear();
}

/** Fails the test when a caller reached a mutation the test did not answer. */
export function assertEveryCallConfigured() {
  if (trpcDouble.unconfigured.length > 0) {
    throw new Error(`unconfigured procedures called: ${trpcDouble.unconfigured.join(", ")}`);
  }
}

/** Answers `procedure` with `answer(input)`; throw inside it to fail the call. */
export function answerQuery(procedure: string, answer: Handler) {
  trpcDouble.queries.set(procedure, answer);
}

export function answerMutation(procedure: string, answer: Handler) {
  trpcDouble.mutations.set(procedure, answer);
}

/** An error as the tRPC client raises a HandledError: the payload under `data.error`. */
export function handledError({ code, httpStatus }: { code: string; httpStatus: number }) {
  return Object.assign(new Error(code), { data: { error: { code, httpStatus, meta: {} } } });
}

const RETRYING = new WeakSet<object>();

/**
 * A failure the client is still retrying, as the tRPC client reports a 500: `error` stays null
 * while `failureReason` holds it.
 */
export function retryingFailure(error: Error): Error {
  RETRYING.add(error);
  return error;
}

/** A read that never answers, for the loading state. */
export const neverAnswers = () => new Promise<never>(() => undefined);

type QueryState = { data: unknown; error: unknown; fetching: boolean; retrying?: boolean };

function useDoubleQuery(procedure: string, input: unknown, options?: { enabled?: boolean }) {
  if (!trpcDouble.queries.has(procedure)) {
    throw new Error(`${procedure} is not configured for this test`);
  }
  const enabled = options?.enabled ?? true;
  const [state, setState] = useState<QueryState>({ data: undefined, error: null, fetching: false });
  const fetchNow = async () => {
    setState((previous) => ({ ...previous, fetching: true }));
    trpcDouble.reads.push(procedure);
    try {
      const data = await trpcDouble.queries.get(procedure)?.(input);
      setState({ data, error: null, fetching: false, retrying: false });
    } catch (error) {
      const retrying = typeof error === "object" && error !== null && RETRYING.has(error);
      setState((previous) => ({ ...previous, error, fetching: retrying, retrying }));
    }
  };
  const fetchRef = useRef(fetchNow);
  useEffect(() => {
    fetchRef.current = fetchNow;
  });

  useEffect(() => {
    if (!enabled) return;
    const refetch = () => fetchRef.current();
    void refetch();
    const set = trpcDouble.mounted.get(procedure) ?? new Set();
    set.add(refetch);
    trpcDouble.mounted.set(procedure, set);
    return () => void set.delete(refetch);
  }, [enabled, procedure]);

  const hasData = state.data !== undefined;
  return {
    data: state.data,
    error: state.retrying ? null : state.error,
    failureReason: state.error,
    isError: !state.retrying && state.error !== null && state.error !== undefined,
    isPending: !hasData,
    isLoading: !hasData && state.fetching,
    isFetching: state.fetching,
    refetch: () => fetchRef.current(),
  };
}

type MutationCallbacks = {
  onSuccess?: (data: unknown) => unknown;
  onError?: (error: unknown) => unknown;
};

function useDoubleMutation(procedure: string, hooks: MutationCallbacks = {}) {
  const [state, setState] = useState<{ pending: boolean; variables: unknown }>({
    pending: false,
    variables: undefined,
  });
  const mutateAsync = async (input: unknown) => {
    const handler = trpcDouble.mutations.get(procedure);
    if (!handler) {
      trpcDouble.unconfigured.push(procedure);
      throw new Error(`${procedure} is not configured for this test`);
    }
    trpcDouble.calls.push({ procedure, input });
    setState({ pending: true, variables: input });
    try {
      return await handler(input);
    } finally {
      setState({ pending: false, variables: undefined });
    }
  };
  /** Runs the hook's callbacks, then the call's, as React Query does. */
  const mutate = (input: unknown, call: MutationCallbacks = {}) =>
    void mutateAsync(input).then(
      async (data) => {
        await hooks.onSuccess?.(data);
        await call.onSuccess?.(data);
      },
      async (error: unknown) => {
        await hooks.onError?.(error);
        await call.onError?.(error);
      },
    );
  return {
    mutateAsync,
    mutate,
    isPending: state.pending,
    variables: state.variables,
    error: null,
  };
}

const LEAVES: Record<string, (path: string) => unknown> = {
  useQuery: (path) => (input: unknown, options?: { enabled?: boolean }) =>
    useDoubleQuery(path, input, options),
  useMutation: (path) => (hooks?: MutationCallbacks) => useDoubleMutation(path, hooks),
};

function utilsNode(path: string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") return undefined;
        if (property !== "invalidate") return utilsNode([...path, property]);
        const procedure = path.join(".");
        if (path.length < 2) throw new Error(`utils.${procedure}.invalidate is not doubled`);
        return async () => {
          trpcDouble.invalidated.push(procedure);
          await Promise.all([...(trpcDouble.mounted.get(procedure) ?? [])].map((run) => run()));
        };
      },
    },
  );
}

function apiNode(path: string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") return undefined;
        if (path.length === 0 && property === "useUtils") return () => utilsNode([]);
        const leaf = LEAVES[property];
        if (leaf && path.length >= 2) return leaf(path.join("."));
        if (path.length >= 2) throw new Error(`${path.join(".")}.${property} is not doubled`);
        return apiNode([...path, property]);
      },
    },
  );
}

/** The binding's module, as `vi.mock` replaces it. */
export function governanceApiDouble() {
  const api = apiNode([]);
  return { api, governanceApi: api };
}
