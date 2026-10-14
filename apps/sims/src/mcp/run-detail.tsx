import { Badge, Button, KeyValue, Panel, Stack, Table } from "@langwatch/design-system-internal";
import { SimRefusal, SimTime, useSimPoll } from "@langwatch/sim-console";

import {
  STATE_TONE,
  durationText,
  fetchRun,
  isActive,
  type Check,
  type Load,
  type Run,
  type Step,
} from "./mcp-api.ts";

const ms = (value: number) => `${value.toFixed(1)} ms`;

const toneOf = ({ status }: { status: number }) => {
  if (status < 300) return "ok";
  return status === 429 || status === 503 ? "warn" : "error";
};

const ChecksPanel = ({ checks }: { checks: Check[] }) => (
  <Panel title="Checks" meta={`${checks.filter((check) => check.pass).length}/${checks.length}`}>
    <Table
      caption="Checks"
      rows={checks}
      rowKey={(check) => check.name}
      empty="No checks yet."
      columns={[
        {
          key: "result",
          header: "Result",
          cell: (check) => (
            <span data-testid="check-result">
              <Badge tone={check.pass ? "ok" : "error"}>{check.pass ? "pass" : "fail"}</Badge>
            </span>
          ),
          width: "96px",
        },
        { key: "name", header: "Check", cell: (check) => check.name },
        { key: "detail", header: "Detail", cell: (check) => check.detail ?? "" },
      ]}
    />
  </Panel>
);

const LoadPanel = ({ load }: { load: Load }) => {
  const answers = Object.entries(load.answers ?? {})
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  const latency = load.latency;
  return (
    <Panel title="Load" meta={latency ? `${latency.samples} attempts` : undefined}>
      <KeyValue
        items={[
          { label: "Clients", value: String(load.clients), copy: false },
          { label: "Sessions", value: String(load.sessions), copy: false },
          { label: "Requests", value: String(load.requests), copy: false },
          { label: "Errors", value: String(load.errors), copy: false },
          { label: "Reinitialized", value: String(load.reinitialized), copy: false },
          { label: "Refreshed", value: String(load.refreshed), copy: false },
          { label: "Retried", value: String(load.retried), copy: false },
          { label: "Answers", value: answers || "none yet", copy: false },
          ...(latency
            ? [
                { label: "p50", value: ms(latency.p50), copy: false },
                { label: "p90", value: ms(latency.p90), copy: false },
                { label: "p99", value: ms(latency.p99), copy: false },
                { label: "Max", value: ms(latency.max), copy: false },
              ]
            : []),
        ]}
      />
    </Panel>
  );
};

const StepsPanel = ({ run }: { run: Run }) => (
  <Panel
    title="Steps"
    meta={
      run.stepsDropped
        ? `${run.steps.length} (${run.stepsDropped} older dropped)`
        : String(run.steps.length)
    }
  >
    <Table
      caption="Steps"
      rows={run.steps}
      rowKey={(step) => `${step.at.getTime()}-${run.steps.indexOf(step)}`}
      empty="No steps yet."
      maxHeight="lg"
      columns={[
        {
          key: "at",
          header: "Time",
          cell: (step: Step) => step.at.toISOString().slice(11, 23),
          mono: true,
        },
        { key: "kind", header: "Kind", cell: (step: Step) => step.kind },
        { key: "flow", header: "Flow", cell: (step: Step) => step.flow ?? "", hideOnNarrow: true },
        {
          key: "transport",
          header: "Transport",
          cell: (step: Step) => step.transport ?? "",
          mono: true,
        },
        {
          key: "method",
          header: "Method",
          cell: (step: Step) => step.method ?? "",
          hideOnNarrow: true,
        },
        {
          key: "url",
          header: "URL",
          cell: (step: Step) => step.url ?? "",
          mono: true,
          hideOnNarrow: true,
        },
        {
          key: "status",
          header: "Status",
          cell: (step: Step) =>
            step.status ? (
              <Badge tone={toneOf({ status: step.status })}>{step.status}</Badge>
            ) : (
              "none"
            ),
        },
        {
          key: "latency",
          header: "ms",
          cell: (step: Step) => step.latencyMs.toFixed(1),
          align: "end",
        },
        {
          key: "ok",
          header: "OK",
          cell: (step: Step) => (
            <Badge tone={step.ok ? "ok" : "error"}>{step.ok ? "ok" : "fail"}</Badge>
          ),
        },
        {
          key: "session",
          header: "Session",
          cell: (step: Step) => step.session ?? "",
          mono: true,
          hideOnNarrow: true,
        },
        {
          key: "detail",
          header: "Detail",
          cell: (step: Step) => step.error ?? step.detail ?? "",
          hideOnNarrow: true,
        },
      ]}
    />
  </Panel>
);

/** One run: settings, checks, soak load stats and the steps the sim recorded. */
export const RunDetail = ({ summary, onStop }: { summary: Run; onStop: () => void }) => {
  const detail = useSimPoll({
    fetch: () => fetchRun({ id: summary.id }),
    everyMs: (data) => (isActive(data ?? summary) ? 1_500 : 30_000),
  });
  const run = detail.data ?? summary;
  return (
    <article data-testid="run-detail">
      <Stack gap={4}>
        {detail.error && <SimRefusal message={detail.error.message} />}
        <Panel
          title={`${run.scenario} · ${run.flow}`}
          meta={
            <>
              <Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>{" "}
              {isActive(run) && (
                <Button size="sm" onClick={onStop}>
                  Stop
                </Button>
              )}
            </>
          }
        >
          <KeyValue
            items={[
              { label: "Run id", value: run.id },
              { label: "Client", value: run.client, copy: false },
              { label: "Endpoint", value: run.endpoint },
              { label: "Transports", value: run.transports.join(", ") || "none", copy: false },
              { label: "Started", value: <SimTime at={run.startedAt} />, copy: false },
              { label: "Duration", value: durationText({ ms: run.durationMs }), copy: false },
              ...(run.error ? [{ label: "Error", value: run.error }] : []),
            ]}
          />
        </Panel>
        <ChecksPanel checks={run.checks} />
        {run.load && <LoadPanel load={run.load} />}
        <StepsPanel run={run} />
      </Stack>
    </article>
  );
};
