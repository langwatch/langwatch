import { Badge, Panel, Section, Stack } from "@langwatch/design-system-internal";
import { SimEmpty, SimList, SimRefusal, SimSplit, SimTime } from "@langwatch/sim-console";
import { useState } from "react";

import { RunDetail } from "./run-detail.tsx";
import { StartRunForm } from "./start-run-form.tsx";
import { STATE_TONE, startRun, type RunRequest } from "./telemetry-api.ts";
import type { ViewProps } from "./view-props.ts";

/** The current run and the ten before it, a start form, and the open run's detail. */
export const RunsView = ({ status, error, refresh }: ViewProps) => {
  const [selectedId, setSelectedId] = useState("");
  const runs = status ? [...(status.run ? [status.run] : []), ...status.recent] : [];
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  const running = status?.run?.state === "running";
  const start = async ({ request }: { request: RunRequest }) => {
    const started = startRun({ request });
    // A send answers only once done, so poll now to show it running meanwhile.
    void refresh();
    const run = await started.finally(() => void refresh());
    setSelectedId(run.id);
  };

  return (
    <Section
      title="Runs"
      description="Seeded send, load and fuzz runs at the stack's OTLP door. One runs at a time; the sim keeps the last ten."
    >
      <Stack gap={4}>
        <StartRunForm presets={status?.presets ?? []} running={running} onStart={start} />
        {error && status === undefined ? (
          <SimRefusal message={error.message} />
        ) : (
          <SimSplit
            list={
              <SimList
                title="Runs"
                meta={String(runs.length)}
                items={runs}
                rowKey={(run) => run.id}
                selectedKey={selected?.id}
                onSelect={setSelectedId}
                renderRow={(run) => (
                  <span data-testid="run-row">
                    {run.mode} {run.preset} · seed {run.seed}
                  </span>
                )}
                rowDescription={(run) =>
                  `${run.id} · sent ${run.sent} · acked ${run.acked} · refused ${run.refused} · failed ${run.failed}`
                }
                rowMeta={(run) => (
                  <>
                    <Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>{" "}
                    <SimTime at={run.startedAt} />
                  </>
                )}
                empty={
                  <SimEmpty
                    title="No runs yet"
                    hint="Start one above, or run haven telemetry send."
                  />
                }
              />
            }
            detail={selected ? <RunDetail key={selected.id} summary={selected} /> : undefined}
            emptyDetail={
              <Panel>
                <SimEmpty
                  title="Select a run"
                  hint="Its rate, answers by status, latency and fuzz findings open here."
                />
              </Panel>
            }
          />
        )}
      </Stack>
    </Section>
  );
};
