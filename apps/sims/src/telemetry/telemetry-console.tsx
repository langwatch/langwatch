import { Button } from "@langwatch/design-system-internal";
import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import { FixturesView } from "./fixtures-view.tsx";
import { RunsView } from "./runs-view.tsx";
import { SendOneView } from "./send-one-view.tsx";
import { SetupView } from "./setup-view.tsx";
import { fetchStatus, stopRun } from "./telemetry-api.ts";

const views = {
  runs: { label: "Runs", view: RunsView },
  send: { label: "Send one", view: SendOneView },
  fixtures: { label: "Fixtures", view: FixturesView },
  setup: { label: "Setup", view: SetupView },
} as const;

type ViewId = keyof typeof views;

const viewIds = Object.keys(views).filter((id): id is ViewId => id in views);

/** The telemetry simulator's console: runs, one-off sends, fixtures and setup. */
export const TelemetryConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus, everyMs: 1_000 });
  const [active, setActive] = useState<ViewId>("runs");
  const View = views[active].view;
  const running = status.data?.run?.state === "running";
  const stop = async () => {
    await stopRun().catch(() => undefined);
    await status.refresh();
  };

  return (
    <SimConsole
      sim="telemetry"
      title="Telemetry"
      stackSlug={status.data?.stack ?? ""}
      tabs={viewIds.map((id) => ({
        id,
        label: views[id].label,
        count:
          id === "runs" && status.data
            ? status.data.recent.length + (status.data.run ? 1 : 0)
            : undefined,
      }))}
      activeTab={active}
      onTab={(id) => setActive(viewIds.find((known) => known === id) ?? "runs")}
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
      <View status={status.data} error={status.error} refresh={status.refresh} />
    </SimConsole>
  );
};
