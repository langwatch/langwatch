import {
  Button,
  ConfirmButton,
  Link,
  Panel,
  StatusDot,
  Table,
  type TableColumn,
} from "@langwatch/design-system-internal";

import type { HubStack, Surface } from "../shared/contract.ts";
import { formatAge, formatBytes } from "../shared/format.ts";
import { logsPath } from "../shared/route.ts";
import { ownSurfaces, surfaceState } from "../shared/surfaces.ts";

const columns: TableColumn<Surface>[] = [
  {
    key: "status",
    header: "Status",
    width: "120px",
    cell: (surface) => <StatusDot {...surfaceState({ status: surface.status })} />,
  },
  { key: "name", header: "Surface", width: "144px", cell: (surface) => surface.name },
  {
    key: "host",
    header: "Hostname",
    mono: true,
    hideOnNarrow: true,
    title: (surface) => surface.url || surface.hostname,
    cell: (surface) =>
      surface.url === "" ? (
        surface.hostname || "no hostname"
      ) : (
        <Link href={surface.url} mono>
          {surface.hostname || surface.url}
        </Link>
      ),
  },
  {
    key: "port",
    header: "Port",
    width: "72px",
    align: "end",
    mono: true,
    muted: true,
    cell: (surface) => (surface.port === 0 ? "—" : String(surface.port)),
  },
];

/** Branch, memory, databases and heartbeat: the old card's chips, on one quiet line. */
const summaryOf = ({ stack, now }: { stack: HubStack; now: number }) => {
  const { facts } = stack;
  return [
    facts.branch,
    facts.baseline ? "baseline" : "",
    stack.live && facts.rssBytes > 0 ? `~${formatBytes({ bytes: facts.rssBytes })}` : "",
    facts.databases.clickhouse.name === "" ? "" : `clickhouse ${facts.databases.clickhouse.name}`,
    facts.databases.redis.db === null ? "" : `redis db ${facts.databases.redis.db}`,
    facts.heartbeatAt === null ? "" : `heartbeat ${formatAge({ at: facts.heartbeatAt, now })}`,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
};

export type StackCardProps = {
  stack: HubStack;
  now: number;
  restarting: boolean;
  onRestart: () => void;
};

export const StackCard = ({ stack, now, restarting, onRestart }: StackCardProps) => {
  const summary = summaryOf({ stack, now });
  return (
    <Panel
      title={stack.homeUrl === "" ? stack.slug : <Link href={stack.homeUrl}>{stack.slug}</Link>}
      meta={
        <span title={`${stack.facts.worktreeDir}\n${summary}`}>
          <StatusDot state={stack.live ? "live" : "down"} label={stack.live ? "Live" : "Stale"} />
          {` · ${summary}`}
        </span>
      }
      actions={
        <>
          <Button size="sm" href={logsPath({ stack: stack.slug })}>
            Logs
          </Button>
          {stack.canRestart && (
            <ConfirmButton
              size="sm"
              variant="secondary"
              label={restarting ? "Restarting" : "Restart"}
              confirmLabel="Restart?"
              disabled={restarting}
              onConfirm={onRestart}
            />
          )}
          {stack.appUrl !== "" && (
            <Button size="sm" href={stack.appUrl}>
              Open
            </Button>
          )}
        </>
      }
    >
      <Table
        columns={columns}
        rows={ownSurfaces({ surfaces: stack.surfaces })}
        rowKey={(surface) => surface.name}
        caption={`${stack.slug} surfaces`}
        empty="No surfaces registered yet."
      />
    </Panel>
  );
};
