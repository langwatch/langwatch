import type { Limit } from "../shared/contract.ts";

const LABELS: Record<string, string> = {
  "clickhouse-memory-mb": "ClickHouse memory",
  "redis-maxmemory-mb": "Redis max memory",
  "observability-memory-mb": "Observability memory",
  "colima-cpus": "VM CPUs",
  "colima-memory-gib": "VM memory",
  "test-workers": "Test workers",
  "instant-eval-mock-judge": "Mock judge for Instant Evals",
};

const AREAS = [
  { title: "Databases", names: ["clickhouse-memory-mb", "redis-maxmemory-mb"] },
  {
    title: "Containers and VM",
    names: ["observability-memory-mb", "colima-cpus", "colima-memory-gib"],
  },
  { title: "Tests", names: ["test-workers"] },
  { title: "Stack features", names: ["instant-eval-mock-judge"] },
];

export type Area = { title: string; limits: Limit[] };

/** The catalog grouped by what it tunes; a limit the console has no area for lands in Other. */
export const areasOf = ({ limits }: { limits: Limit[] }): Area[] => {
  const known = new Set(AREAS.flatMap((area) => area.names));
  const areas = [
    ...AREAS.map((area) => ({
      title: area.title,
      limits: limits.filter((limit) => area.names.includes(limit.name)),
    })),
    { title: "Other", limits: limits.filter((limit) => !known.has(limit.name)) },
  ];
  return areas.filter((area) => area.limits.length > 0);
};

export const labelOf = ({ limit }: { limit: Limit }) => LABELS[limit.name] ?? limit.name;

/** The daemon reports a switch as the unit "on", bounded 0 to 1. */
export const isSwitch = ({ limit }: { limit: Limit }) => limit.unit === "on";

export const SOURCE_LABELS: Record<Limit["source"], string> = {
  default: "default",
  settings: "settings",
  ".env": ".env",
  env: "environment",
};

export const rangeOf = ({ limit }: { limit: Limit }) =>
  `${limit.allowZero ? "0 or " : ""}${limit.min} to ${limit.max}`;

/** The value a draft says, or undefined when it is not a whole number the machine accepts. */
export const parseDraft = ({ limit, text }: { limit: Limit; text: string }) => {
  const value = Number(text);
  if (text.trim() === "" || !Number.isInteger(value)) return undefined;
  const allowed = (limit.allowZero && value === 0) || (value >= limit.min && value <= limit.max);
  return allowed ? value : undefined;
};

export type Change = { limit: Limit; value: number };

/** What Save would send, and the limits whose draft is not a value the machine accepts. */
export const changesOf = ({
  limits,
  drafts,
}: {
  limits: Limit[];
  drafts: Record<string, string>;
}) => {
  const changes: Change[] = [];
  const invalid: string[] = [];
  for (const limit of limits) {
    const text = drafts[limit.name];
    if (text === undefined) continue;
    const value = parseDraft({ limit, text });
    if (value === undefined) invalid.push(limit.name);
    else if (value !== limit.value) changes.push({ limit, value });
  }
  return { changes, invalid };
};
