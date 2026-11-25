/**
 * The view-drawer suites' react-query stand-ins, shared state and rows. Each
 * suite's `vi.mock` calls `viewDrawerApi`/`viewDrawerSlackApi` through
 * `vi.importActual`, so query semantics cannot drift; cases set the state.
 */
import { vi } from "vitest";

/**
 * One react-query hook result. `enabled: false` never resolves, so it reports
 * `isLoading` forever; `undefined` is unresolved, `null` a settled "nothing".
 */
export const fakeQuery = (data: unknown, options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  const settled = enabled && data !== undefined;
  return {
    data,
    isLoading: !settled,
    isFetching: enabled && !settled,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
};

type Row = Record<string, unknown>;

/** What every stand-in answers; reset with `resetViewDrawerState` before each case. */
export const viewDrawerState = {
  trigger: undefined as Row | null | undefined,
  triggerError: null as unknown,
  fires: [] as Row[],
  hasNextFirePage: false,
  fetchNextFirePage: vi.fn(),
  fireHistoryFails: false,
  evaluationFails: false,
  latestEvaluation: null as Row | null | undefined,
  nextFiring: { kind: "immediate", traceDebounceMs: 30_000 } as Row | null | undefined,
  webhookDeliveries: [] as Row[],
  matchingTraces: undefined as Row | undefined,
  tracesListInputs: [] as unknown[],
  slackConnections: [{ id: "conn-bot", name: "Alerts bot" }] as Row[],
};

export function resetViewDrawerState(): void {
  viewDrawerState.trigger = undefined;
  viewDrawerState.triggerError = null;
  viewDrawerState.fires = [];
  viewDrawerState.hasNextFirePage = false;
  viewDrawerState.fetchNextFirePage = vi.fn();
  viewDrawerState.fireHistoryFails = false;
  viewDrawerState.evaluationFails = false;
  viewDrawerState.latestEvaluation = null;
  viewDrawerState.nextFiring = { kind: "immediate", traceDebounceMs: 30_000 };
  viewDrawerState.webhookDeliveries = [];
  viewDrawerState.matchingTraces = undefined;
  viewDrawerState.tracesListInputs = [];
  viewDrawerState.slackConnections = [{ id: "conn-bot", name: "Alerts bot" }];
}

type Options = { enabled?: boolean };
/** A settled failure: no data, `isError`, and an error to describe. */
const failedQuery = () => ({
  ...fakeQuery(undefined),
  isLoading: false,
  isFetching: false,
  isError: true,
  error: new Error("boom"),
});

const read = (pick: () => unknown) => ({
  useQuery: (_input: unknown, options?: Options) => fakeQuery(pick(), options),
});

/** The automation api as the view drawer calls it. */
export function viewDrawerApi() {
  const s = viewDrawerState;
  return {
    automation: {
      getTriggerById: {
        useQuery: (_input: unknown, options?: Options) =>
          s.triggerError
            ? { ...fakeQuery(undefined, options), isLoading: false, error: s.triggerError }
            : fakeQuery(s.trigger, options),
      },
      getFireHistory: {
        useInfiniteQuery: (_input: unknown, options?: Options) => ({
          ...(s.fireHistoryFails
            ? failedQuery()
            : fakeQuery({ pages: [{ fires: s.fires, nextCursor: null }] }, options)),
          hasNextPage: s.hasNextFirePage,
          isFetchingNextPage: false,
          fetchNextPage: s.fetchNextFirePage,
        }),
      },
      getLatestEvaluation: {
        useQuery: (_input: unknown, options?: Options) =>
          s.evaluationFails && options?.enabled
            ? failedQuery()
            : fakeQuery(s.latestEvaluation, options),
      },
      getNextFiring: read(() => s.nextFiring),
      getWebhookDeliveries: read(() => s.webhookDeliveries),
    },
    graphs: { getById: read(() => null) },
    dataset: { getAll: read(() => []) },
    traces: {
      list: {
        useQuery: (input: unknown, options?: Options) => {
          if (options?.enabled) s.tracesListInputs.push(input);
          return fakeQuery(s.matchingTraces, options);
        },
      },
    },
  };
}

/** The Slack kit's client as the view drawer calls it. */
export function viewDrawerSlackApi() {
  return {
    slackIntegration: {
      list: read(() => ({ connections: viewDrawerState.slackConnections })),
    },
  };
}

export const GRAPH_ALERT_ROW = {
  id: "trigger_1",
  name: "p95 latency alert",
  active: true,
  action: "SEND_SLACK_MESSAGE",
  customGraphId: "graph_1",
  filters: "{}",
  filterQuery: null,
  triggerKind: "ALERT",
  actionParams: {
    slackWebhook: "https://hooks.slack.com/services/abc",
    seriesName: "0/latency/p95",
    operator: "gt",
    threshold: 100,
    timePeriod: 60,
  },
};

export const TRACE_AUTOMATION_ROW = {
  id: "trigger_1",
  name: "Errors to Slack",
  active: true,
  action: "SEND_SLACK_MESSAGE",
  customGraphId: null,
  filters: "{}",
  filterQuery: "status:error",
  triggerKind: "AUTOMATION",
  actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
};
