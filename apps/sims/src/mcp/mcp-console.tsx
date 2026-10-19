import { Button } from "@langwatch/design-system-internal";
import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import { fetchStatus, isActive } from "./mcp-api.ts";
import { RunsView } from "./runs-view.tsx";
import { SetupView } from "./setup-view.tsx";

const views = {
  runs: { label: "Runs", view: RunsView },
  setup: { label: "Setup", view: SetupView },
} as const;

type ViewId = keyof typeof views;

const viewIds = Object.keys(views).filter((id): id is ViewId => id in views);

/** The MCP simulator's console: scenario runs against the hosted MCP endpoint, and its setup. */
export const McpConsole = () => {
  const [active, setActive] = useState<ViewId>("runs");
  // Poll fast while a run is going or waiting, slowly otherwise.
  const status = useSimPoll({
    fetch: fetchStatus,
    everyMs: (data) => (data?.runs.some(isActive) ? 1_500 : 4_000),
  });
  const View = views[active].view;

  return (
    <SimConsole
      sim="mcp"
      title="MCP"
      stackSlug={status.data?.stack ?? ""}
      tabs={viewIds.map((id) => ({
        id,
        label: views[id].label,
        count: id === "runs" && status.data ? status.data.runs.length : undefined,
      }))}
      activeTab={active}
      onTab={(id) => setActive(viewIds.find((known) => known === id) ?? "runs")}
      status={
        status.error
          ? { tone: "error", text: status.error.message }
          : {
              tone: status.data?.oauth.connected ? "ok" : "warn",
              text: `MCP at ${status.data?.endpoint ?? "no endpoint"}, OAuth ${status.data?.oauth.connected ? "connected" : "not connected"}`,
            }
      }
      actions={
        <Button size="sm" onClick={() => void status.refresh()}>
          Refresh
        </Button>
      }
    >
      <View status={status.data} error={status.error} refresh={status.refresh} />
    </SimConsole>
  );
};
