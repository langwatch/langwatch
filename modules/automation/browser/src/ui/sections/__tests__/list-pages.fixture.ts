/**
 * Rows and stand-ins for the list-page suites: a graph watch, a report and
 * trace-filter automations over Slack webhook, Slack bot and webhook delivery.
 * Each suite's `vi.mock` factory calls `listPagesApi` via `vi.importActual`.
 */
import { vi } from "vitest";

export const graphTrigger = {
  id: "alert-1",
  name: "Cost spike",
  active: true,
  pausedReason: null,
  customGraphId: "graph-1",
  customGraph: { id: "graph-1", name: "Cost graph" },
  triggerKind: "ALERT",
  action: "SEND_EMAIL",
  actionParams: {
    seriesName: "cost",
    operator: "gt",
    threshold: 10,
    timePeriod: 60,
    members: ["a@b.com"],
  },
  checks: [],
  filterQuery: null,
  filters: "{}",
  notificationCadence: "immediate",
};

export const scheduleTrigger = {
  ...graphTrigger,
  id: "schedule-1",
  name: "Weekly digest",
  customGraphId: null,
  customGraph: null,
  triggerKind: "REPORT",
  actionParams: {
    source: { kind: "traceQuery", topN: 5 },
    schedule: { cron: "0 9 * * 1", timezone: "UTC" },
    members: ["a@b.com"],
  },
};

const traceAutomation = {
  ...graphTrigger,
  customGraphId: null,
  customGraph: null,
  triggerKind: "AUTOMATION",
  filterQuery: "status:error",
};

export const filterTrigger = {
  ...traceAutomation,
  id: "automation-1",
  name: "Flag failures",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackWebhook: "https://hooks.slack.example/x" },
};

export const botSlackTrigger = {
  ...traceAutomation,
  id: "automation-2",
  name: "Errors to #ops",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackDelivery: "bot", slackChannelId: "C0999999" },
};

export const webhookTrigger = {
  ...traceAutomation,
  id: "automation-3",
  name: "Errors to our endpoint",
  action: "SEND_WEBHOOK",
  actionParams: { url: "https://example.com/hooks/langwatch", method: "POST" },
};

export const allTriggers = [
  graphTrigger,
  scheduleTrigger,
  filterTrigger,
  botSlackTrigger,
  webhookTrigger,
];

/** The mutations and cache calls a case asserts on; reset per case. */
export const listPagesMocks = {
  deleteMutate: vi.fn(),
  toggleMutate: vi.fn(),
  invalidateTriggerById: vi.fn(),
};

const settled = (data: unknown) => ({ data, isLoading: false, refetch: vi.fn() });

/** The automation api as the list pages call it. */
export function listPagesApi() {
  return {
    automation: {
      getTriggers: { useQuery: () => settled(allTriggers) },
      getTriggerStats: { useQuery: () => settled([]) },
      getDailyCapStatus: { useQuery: () => settled({ counts: {}, cap: 0 }) },
      getReportSchedules: { useQuery: () => settled([]) },
      getRecentActivity: { useQuery: () => settled([]) },
      toggleTrigger: {
        useMutation: () => ({ mutate: listPagesMocks.toggleMutate, isPending: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: listPagesMocks.deleteMutate, isPending: false }),
      },
    },
    dataset: { getAll: { useQuery: () => settled([]) } },
    graphs: { getAll: { useQuery: () => settled([]) } },
    useUtils: () => ({
      automation: { getTriggerById: { invalidate: listPagesMocks.invalidateTriggerById } },
    }),
  };
}

/** The Slack kit's client: the project has no named connections. */
export function listPagesSlackApi() {
  return { slackIntegration: { list: { useQuery: () => settled({ connections: [] }) } } };
}
