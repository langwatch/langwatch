import { Badge, Button, Inline, Panel, Section, Stack } from "@langwatch/design-system-internal";
import { SimEmpty, SimList, SimRefusal, SimSplit, SimTime } from "@langwatch/sim-console";
import { useState } from "react";

import { AuthorizeBanner } from "./authorize-banner.tsx";
import {
  STATE_TONE,
  clearRuns,
  durationText,
  isActive,
  startRun,
  stopRun,
  type Run,
  type RunRequest,
} from "./mcp-api.ts";
import { RunDetail } from "./run-detail.tsx";
import { StartRunForm } from "./start-run-form.tsx";
import type { ViewProps } from "./view-props.ts";

const checksOf = ({ checks }: { checks: Run["checks"] }) =>
  `${checks.filter((check) => check.pass).length}/${checks.length} checks`;

/** The scenario buttons, the runs (newest first) and the open run's detail. */
export const RunsView = ({ status, error, refresh }: ViewProps) => {
  const [selectedId, setSelectedId] = useState("");
  const [refusal, setRefusal] = useState("");
  const runs = status?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  const waiting = runs.find((run) => run.state === "waiting");
  const hasFinished = runs.some((run) => !isActive(run));

  const start = async ({ request }: { request: RunRequest }) => {
    const run = await startRun({ request }).finally(() => void refresh());
    setSelectedId(run.id);
  };
  const guarded = async (action: () => Promise<unknown>) => {
    setRefusal("");
    try {
      await action();
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    }
    await refresh();
  };

  return (
    <Section
      title="Runs"
      description="Scenarios that stand in for Claude Desktop, Claude Code and Cursor against the hosted MCP endpoint."
    >
      <Stack gap={4}>
        {waiting && <AuthorizeBanner run={waiting} />}
        <StartRunForm
          scenarios={status?.scenarios ?? []}
          connected={status?.oauth.connected ?? false}
          onStart={start}
        />
        {refusal !== "" && <SimRefusal message={refusal} />}
        {error && status === undefined ? (
          <SimRefusal message={error.message} />
        ) : (
          <SimSplit
            list={
              <SimList
                title="Runs"
                meta={String(runs.length)}
                actions={
                  <Button size="sm" disabled={!hasFinished} onClick={() => void guarded(clearRuns)}>
                    Clear
                  </Button>
                }
                items={runs}
                rowKey={(run) => run.id}
                selectedKey={selected?.id}
                onSelect={setSelectedId}
                renderRow={(run) => (
                  <span data-testid="run-row">
                    {run.scenario} · {run.flow}
                  </span>
                )}
                rowDescription={(run) =>
                  `${run.id} · ${run.transports.join(", ") || "no transport"} · ${durationText({ ms: run.durationMs })} · ${checksOf(run)}`
                }
                rowMeta={(run) => (
                  <Inline gap={2}>
                    <Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>
                    <SimTime at={run.startedAt} />
                  </Inline>
                )}
                empty={<SimEmpty title="No runs yet" hint="Start a scenario above." />}
              />
            }
            detail={
              selected ? (
                <RunDetail
                  key={selected.id}
                  summary={selected}
                  onStop={() => void guarded(() => stopRun({ id: selected.id }))}
                />
              ) : undefined
            }
            emptyDetail={
              <Panel>
                <SimEmpty title="Select a run" hint="Its checks, load stats and steps open here." />
              </Panel>
            }
          />
        )}
      </Stack>
    </Section>
  );
};
