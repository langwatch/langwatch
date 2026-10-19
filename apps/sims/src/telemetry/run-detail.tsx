import { Badge, KeyValue, Panel, Stack, Table, Text } from "@langwatch/design-system-internal";
import { SimRefusal, useSimPoll } from "@langwatch/sim-console";
import { nowInstant } from "@langwatch/time";

import {
  STATE_TONE,
  elapsedSeconds,
  fetchRun,
  sentRate,
  statusMeaning,
  type Run,
} from "./telemetry-api.ts";

const toneOf = ({ status }: { status: number }) => {
  if (status < 300) return "ok";
  return status === 429 || status === 503 ? "warn" : "error";
};

const ms = (value: number) => `${value.toFixed(1)} ms`;

/** Every attempt's status, retries included, lowest first. */
const AnswersPanel = ({ run }: { run: Run }) => {
  const rows = Object.entries(run.answers ?? {})
    .map(([status, count]) => ({ status: Number(status), count }))
    .toSorted((a, b) => a.status - b.status);
  return (
    <Panel
      title="Answers by status"
      meta={
        run.retryAfterSeen ? (
          <Badge tone="warn">
            Retry-After {run.retryAfterSeen}× (last {run.lastRetryAfter})
          </Badge>
        ) : undefined
      }
    >
      <Table
        caption="Answers by status"
        rows={rows}
        rowKey={(row) => String(row.status)}
        empty="No answers yet."
        columns={[
          {
            key: "status",
            header: "Status",
            cell: (row) => <Badge tone={toneOf(row)}>{row.status}</Badge>,
            width: "96px",
          },
          {
            key: "meaning",
            header: "Meaning",
            cell: (row) => statusMeaning[String(row.status)] ?? "",
          },
          { key: "count", header: "Attempts", cell: (row) => String(row.count), align: "end" },
        ]}
      />
    </Panel>
  );
};

/** A fuzz run's mutations, findings (a 5xx or no answer) first. */
const MutationsPanel = ({ run }: { run: Run }) => {
  const isFinding = ({ status }: { status: number }) => Number(status === 0 || status >= 500);
  const mutations = (run.mutations ?? []).toSorted((a, b) => isFinding(b) - isFinding(a));
  if (run.mode !== "fuzz") return null;
  return (
    <Panel title="Mutations" meta={String(mutations.length)}>
      <Table
        caption="Mutations"
        rows={mutations}
        rowKey={(m) => m.id}
        empty="No mutations sent yet."
        columns={[
          { key: "id", header: "Mutation id", cell: (m) => m.id, mono: true },
          {
            key: "status",
            header: "Answer",
            cell: (m) => (m.status === 0 ? "none" : <Badge tone={toneOf(m)}>{m.status}</Badge>),
            width: "96px",
          },
          { key: "error", header: "Error", cell: (m) => m.error ?? "", hideOnNarrow: true },
        ]}
      />
    </Panel>
  );
};

/** One run: settings, counters, rate, latency, answers by status and fuzz mutations. */
export const RunDetail = ({ summary }: { summary: Run }) => {
  const detail = useSimPoll({
    fetch: () => fetchRun({ id: summary.id }),
    everyMs: summary.state === "running" ? 1_000 : 30_000,
  });
  const run = detail.data ?? summary;
  const now = nowInstant();
  const latency = run.latency;
  return (
    <article data-testid="run-detail">
      <Stack gap={4}>
        {detail.error && <SimRefusal message={detail.error.message} />}
        <Panel
          title={`${run.mode} ${run.preset}`}
          meta={<Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>}
        >
          <KeyValue
            items={[
              { label: "Run id", value: run.id },
              { label: "Seed", value: String(run.seed) },
              { label: "Endpoint", value: run.endpoint },
              { label: "Body", value: `${run.encoding}${run.gzip ? ", gzip" : ""}`, copy: false },
              {
                label: "Rate",
                value: `${sentRate({ run, now }).toFixed(1)}/s${run.targetRate ? ` of ${run.targetRate}/s` : ""}`,
                copy: false,
              },
              {
                label: "Elapsed",
                value: `${elapsedSeconds({ run, now }).toFixed(1)}s`,
                copy: false,
              },
              {
                label: "Sent",
                value: `${run.sent} = ${run.acked} acked + ${run.refused} refused + ${run.failed} failed`,
                copy: false,
              },
              { label: "Retried", value: String(run.retried), copy: false },
              { label: "Late ticks", value: String(run.late), copy: false },
              ...(run.lastError ? [{ label: "Last error", value: run.lastError }] : []),
            ]}
          />
        </Panel>
        <Panel title="Latency" meta={latency ? `${latency.samples} attempts` : undefined}>
          {latency ? (
            <KeyValue
              items={[
                { label: "p50", value: ms(latency.p50), copy: false },
                { label: "p90", value: ms(latency.p90), copy: false },
                { label: "p99", value: ms(latency.p99), copy: false },
                { label: "Max", value: ms(latency.max), copy: false },
              ]}
            />
          ) : (
            <Text tone="muted">No attempt has finished yet.</Text>
          )}
        </Panel>
        <AnswersPanel run={run} />
        <MutationsPanel run={run} />
      </Stack>
    </article>
  );
};
