import {
  Badge,
  Callout,
  Code,
  EmptyState,
  Page,
  Panel,
  Section,
  Stack,
} from "@langwatch/design-system-internal";

import { START_PATH, restartPath } from "../shared/api.ts";
import { nowMs } from "../shared/clock.ts";
import { Connection } from "../shared/connection.tsx";
import type { Hub } from "../shared/contract.ts";
import { formatCount } from "../shared/format.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { ownSurfaces } from "../shared/surfaces.ts";
import { useLifecycle } from "../shared/use-lifecycle.ts";
import type { Poll } from "../shared/use-poll.ts";
import { IdleWorktrees } from "./idle-worktrees.tsx";
import { MachinePanels } from "./machine-panels.tsx";
import { Reaping } from "./reaping.tsx";
import { StackCard } from "./stack-card.tsx";

/** The old stats row as one sentence: stacks, services, agents, databases. */
const summaryOf = ({ hub }: { hub: Hub }) => {
  const live = hub.stacks.filter((stack) => stack.live).length;
  const surfaces = hub.stacks.flatMap((stack) => ownSurfaces({ surfaces: stack.surfaces }));
  const up = surfaces.filter((surface) => surface.status === "live").length;
  const databases = hub.stacks.reduce(
    (total, stack) => total + 1 + (stack.facts.databases.clickhouse.name === "" ? 0 : 1),
    0,
  );
  return [
    `${live} of ${hub.stacks.length} stacks live`,
    `${up} of ${surfaces.length} services up`,
    `${formatCount({ count: hub.machine.agentCount })} agents`,
    `${databases} databases`,
  ].join(" · ");
};

const PRESSURE_TONES = { amber: "warn", red: "error" } as const;

const Pressure = ({ pressure }: { pressure: string }) => {
  if (pressure !== "amber" && pressure !== "red") return null;
  return <Badge tone={PRESSURE_TONES[pressure]}>{`Memory pressure ${pressure}`}</Badge>;
};

const NoStacks = () => (
  <Panel>
    <EmptyState
      title="Nothing running yet"
      description="Bring a stack up from any worktree and it appears here, on its own hostname."
      action={<Code>haven up</Code>}
    />
  </Panel>
);

export const Overview = ({ poll }: { poll: Poll<Hub> }) => {
  const { data: hub, error, updatedAt } = poll;
  const { busy, act } = useLifecycle({ refresh: poll.refresh });
  const now = updatedAt ?? nowMs();
  return (
    <Page
      nav={<HavenTopBar current="hub" hubHref="/" />}
      title="What this machine is running"
      subtitle={hub === undefined ? "Reading the machine…" : summaryOf({ hub })}
      actions={
        <>
          {hub !== undefined && <Pressure pressure={hub.machine.pressure} />}
          <Connection error={error} updatedAt={updatedAt} />
        </>
      }
    >
      {hub === undefined && error !== undefined && (
        <Callout tone="error" title="The haven daemon is not answering">
          {error}
        </Callout>
      )}
      {hub !== undefined && (
        <>
          <MachinePanels hub={hub} />
          <Section
            title="Stacks"
            description="Each links to its home: surfaces, errors and sign-in."
          >
            {hub.stacks.length === 0 ? (
              <NoStacks />
            ) : (
              <Stack gap={4}>
                {hub.stacks.map((stack) => (
                  <StackCard
                    key={stack.slug}
                    stack={stack}
                    now={now}
                    restarting={busy === stack.slug}
                    onRestart={() =>
                      void act({
                        key: stack.slug,
                        path: restartPath({ slug: stack.slug }),
                        doing: `restart ${stack.slug}`,
                      })
                    }
                  />
                ))}
              </Stack>
            )}
          </Section>
          {hub.worktrees.length > 0 && (
            <Section title="Worktrees" description="Nothing running from these.">
              <IdleWorktrees
                worktrees={hub.worktrees}
                starting={busy}
                onStart={(worktree) =>
                  void act({
                    key: worktree.dir,
                    path: START_PATH,
                    body: { dir: worktree.dir },
                    doing: `start ${worktree.name}`,
                  })
                }
              />
            </Section>
          )}
          {hub.events.length > 0 && (
            <Section title="Recent reaping" description="What the daemon reclaimed, newest first.">
              <Reaping events={hub.events} now={now} />
            </Section>
          )}
        </>
      )}
    </Page>
  );
};
