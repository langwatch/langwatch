import { Badge, KeyValue, Panel } from "@langwatch/design-system-internal";
import { SimEmpty } from "@langwatch/sim-console";
import type { Instant } from "@langwatch/time";

import { elapsedSeconds, sentRate, type Run } from "./telemetry-api.ts";

const STATE_TONE = { running: "brand", done: "ok", stopped: "warn" } as const;

/** The current run: its settings and live counters, re-read on every poll. */
export const RunStatusPanel = ({ run, now }: { run?: Run; now: Instant }) => {
  if (run === undefined) {
    return (
      <Panel title="Current run">
        <SimEmpty title="No run yet" hint="Start one below, or run haven telemetry send." />
      </Panel>
    );
  }
  return (
    <Panel title="Current run" meta={<Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>}>
      <div data-testid="run-status">
        <KeyValue
          items={[
            { label: "Verb", value: run.mode },
            { label: "Preset", value: run.preset },
            { label: "Seed", value: String(run.seed) },
            { label: "Sent", value: String(run.sent), copy: false },
            { label: "Acked", value: String(run.acked), copy: false },
            { label: "Refused", value: String(run.refused), copy: false },
            { label: "Failed", value: String(run.failed), copy: false },
            {
              label: "Rate",
              value: `${sentRate({ run, now }).toFixed(1)}/s${run.targetRate ? ` of ${run.targetRate}/s` : ""}`,
              copy: false,
            },
            { label: "Elapsed", value: `${elapsedSeconds({ run, now }).toFixed(1)}s`, copy: false },
            { label: "Endpoint", value: run.endpoint },
            ...(run.lastError ? [{ label: "Last error", value: run.lastError }] : []),
          ]}
        />
      </div>
    </Panel>
  );
};
