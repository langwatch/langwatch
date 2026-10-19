import { KeyValue, Panel, type KeyValueItem } from "@langwatch/design-system-internal";

import type { Facts } from "../shared/contract.ts";
import { formatAge, formatBytes, formatDuration } from "../shared/format.ts";

const withPort = ({ name, port }: { name: string; port: number }) =>
  port === 0 ? name : `${name} :${port}`;

const redisOf = ({ redis }: { redis: Facts["databases"]["redis"] }) => {
  const db = redis.db === null ? "db allocated at up" : `db ${redis.db}`;
  return withPort({ name: db, port: redis.port });
};

const databaseItem = ({
  label,
  database,
}: {
  label: string;
  database: { name: string; port: number };
}): KeyValueItem => ({
  label,
  value: database.name === "" ? "—" : withPort(database),
  copy: database.name === "" ? false : database.name,
});

export const FactsPanel = ({ facts, now }: { facts: Facts; now: number }) => {
  const { postgres, clickhouse, redis } = facts.databases;
  const items: KeyValueItem[] = [
    { label: "Branch", value: facts.branch || "—", copy: facts.branch !== "" },
    { label: "Worktree", value: facts.worktreeDir || "—", copy: facts.worktreeDir !== "" },
    {
      label: "Layout",
      value: facts.baseline ? `${facts.layout}, baseline` : facts.layout,
      copy: false,
    },
    { label: "Uptime", value: formatDuration({ seconds: facts.uptimeSeconds }), copy: false },
    { label: "Memory", value: formatBytes({ bytes: facts.rssBytes }), copy: false },
    {
      label: "Heartbeat",
      value: facts.heartbeatAt === null ? "—" : formatAge({ at: facts.heartbeatAt, now }),
      copy: false,
    },
    databaseItem({ label: "Postgres", database: postgres }),
    databaseItem({ label: "ClickHouse", database: clickhouse }),
    { label: "Redis", value: redisOf({ redis }), copy: false },
  ];
  return (
    <Panel title="Facts">
      <KeyValue items={items} />
    </Panel>
  );
};
