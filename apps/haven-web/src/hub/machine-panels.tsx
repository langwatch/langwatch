import { Grid, KeyValue, Link, Meter, Panel, Stack, Text } from "@langwatch/design-system-internal";

import type { Hub, Machine } from "../shared/contract.ts";
import { formatBytes } from "../shared/format.ts";

const SHARED_SERVERS = ["clickhouse", "postgres", "redis", "containers"];

const sum = ({ values }: { values: number[] }) => values.reduce((total, value) => total + value, 0);

const breakdownOf = ({ machine }: { machine: Machine }) => {
  const servers = sum({ values: Object.values(machine.serverRssBytes) });
  return [
    machine.stacksRssBytes > 0 ? `stacks ~${formatBytes({ bytes: machine.stacksRssBytes })}` : "",
    servers > 0 ? `servers ~${formatBytes({ bytes: servers })}` : "",
    machine.agentRssBytes > 0
      ? `agents ~${formatBytes({ bytes: machine.agentRssBytes })} (${machine.agentCount})`
      : "",
    machine.toolingRssBytes > 0
      ? `tooling ~${formatBytes({ bytes: machine.toolingRssBytes })}`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
};

/** The shared servers, stated once for the machine rather than on every stack. */
const sharedNoteOf = ({ machine }: { machine: Machine }) => {
  const parts = SHARED_SERVERS.flatMap((name) => {
    const bytes = machine.serverRssBytes[name] ?? 0;
    return bytes > 0 ? [`${name} ~${formatBytes({ bytes })}`] : [];
  });
  return parts.length === 0 ? "" : `Shared by every stack: ${parts.join(" · ")}`;
};

const MemoryPanel = ({ machine }: { machine: Machine }) => {
  const total = machine.totalRamBytes;
  const breakdown = breakdownOf({ machine });
  const sharedNote = sharedNoteOf({ machine });
  const ofTotal = ({ bytes }: { bytes: number }) =>
    `~${formatBytes({ bytes })} of ${formatBytes({ bytes: total })}`;
  return (
    <Panel
      title="Memory"
      meta={total > 0 ? `${formatBytes({ bytes: total })} in this machine` : undefined}
    >
      {total === 0 || machine.devRssBytes === 0 ? (
        <Text tone="secondary">No memory reading yet.</Text>
      ) : (
        <Stack gap={4}>
          <Meter
            label="Dev work"
            value={machine.devRssBytes}
            max={total}
            detail={ofTotal({ bytes: machine.devRssBytes })}
          />
          <Meter
            label="Everything else"
            value={machine.otherRssBytes}
            max={total}
            tone="neutral"
            detail={ofTotal({ bytes: machine.otherRssBytes })}
          />
          <Stack gap={1}>
            {breakdown.length > 0 && (
              <Text size="sm" tone="secondary">
                {breakdown}
              </Text>
            )}
            {sharedNote.length > 0 && (
              <Text size="sm" tone="muted">
                {sharedNote}
              </Text>
            )}
          </Stack>
        </Stack>
      )}
    </Panel>
  );
};

const SharedPanel = ({ shared }: { shared: Hub["shared"] }) => (
  <Panel title="Machine-wide">
    <KeyValue
      items={[
        {
          label: "Grafana",
          value: (
            <Link href={shared.observabilityUrl} mono external>
              {shared.observabilityUrl}
            </Link>
          ),
          copy: shared.observabilityUrl,
        },
        { label: "Telemetry", value: shared.telemetryUrl },
        { label: "Hub", value: shared.hubUrl },
      ]}
    />
  </Panel>
);

export const MachinePanels = ({ hub }: { hub: Hub }) => (
  <Grid columns={2}>
    <MemoryPanel machine={hub.machine} />
    <SharedPanel shared={hub.shared} />
  </Grid>
);
