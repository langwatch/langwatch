import { Button, Stack } from "@langwatch/design-system-internal";
import { SimConsole, SimRefusal, useSimPoll } from "@langwatch/sim-console";
import { nowInstant } from "@langwatch/time";

import { RecentRuns } from "./recent-runs.tsx";
import { RunStatusPanel } from "./run-status-panel.tsx";
import { StartRunForm } from "./start-run-form.tsx";
import { fetchStatus, startRun, stopRun, type RunRequest } from "./telemetry-api.ts";

/** The telemetry simulator's console: the current run, a start form and the runs before it. */
export const TelemetryConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus, everyMs: 1_000 });
  const run = status.data?.run;
  const running = run?.state === "running";
  const start = async ({ request }: { request: RunRequest }) => {
    const started = startRun({ request });
    // A send answers only once done, so poll now to show it running meanwhile.
    void status.refresh();
    await started.finally(() => void status.refresh());
  };
  const stop = async () => {
    await stopRun().catch(() => undefined);
    await status.refresh();
  };

  return (
    <SimConsole
      sim="telemetry"
      title="Telemetry"
      stackSlug={status.data?.stack ?? ""}
      tabs={[]}
      activeTab=""
      onTab={() => undefined}
      status={
        status.error
          ? { tone: "error", text: status.error.message }
          : {
              tone: "ok",
              text: `Sends OTLP to ${status.data?.endpoint ?? "the target each run names"}`,
            }
      }
      actions={
        <Button size="sm" disabled={!running} onClick={() => void stop()}>
          Stop
        </Button>
      }
    >
      {status.error && status.data === undefined ? (
        <SimRefusal message={status.error.message} />
      ) : (
        <Stack gap={4}>
          <RunStatusPanel run={run} now={nowInstant()} />
          <StartRunForm presets={status.data?.presets ?? []} running={running} onStart={start} />
          <RecentRuns runs={status.data?.recent ?? []} />
        </Stack>
      )}
    </SimConsole>
  );
};
