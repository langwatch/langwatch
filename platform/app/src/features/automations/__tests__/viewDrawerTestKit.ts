/**
 * Shared contract for the view-drawer suites' react-query stand-ins, plus the
 * trigger-row fixtures they all read. The api `vi.mock` wiring itself stays in
 * each test file (mock factories are per-module), but every factory closure
 * calls THIS `fakeQuery`, so the query semantics can't drift between suites.
 *
 * Referencing an imported function inside a mock factory's closures is safe:
 * the factory only builds closures, and they read the live binding at render
 * time — after every import has initialized.
 */
import { vi } from "vitest";

/**
 * A faithful-enough stand-in for one react-query v4 hook result.
 *
 * `enabled: false` is the case that matters: such a query never resolves, so
 * it reports `isLoading` FOREVER. A mock that hard-codes `isLoading: false`
 * makes that state unrepresentable — which is how a permanent skeleton over
 * every non-alert automation's history shipped once already.
 *
 * `undefined` means "has not resolved"; `null` means "resolved, and the
 * answer is nothing" (an automation that was never evaluated), which is a
 * settled query with `data === null`.
 */
export const fakeQuery = (data: unknown, options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  const settled = enabled && data !== undefined;
  return {
    data,
    isLoading: !settled,
    isFetching: enabled && !settled,
    error: null,
    refetch: vi.fn(),
  };
};

export const GRAPH_ALERT_ROW = {
  id: "trigger_1",
  name: "p95 latency alert",
  active: true,
  action: "SEND_SLACK_MESSAGE",
  customGraphId: "graph_1",
  filters: "{}",
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
