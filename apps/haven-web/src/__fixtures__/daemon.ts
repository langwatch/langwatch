import { isoOf } from "../shared/clock.ts";
import type {
  CapturedLine,
  Hub,
  HubStack,
  Logs,
  NotFound,
  StackHome,
  Surface,
} from "../shared/contract.ts";

/*
 * What the daemon answers for a small machine: "feat-x" live with a mix of
 * surface states, "stopped" known but down, "nope" unknown. The component
 * tests and scripts/screenshot.ts both read these.
 */

const DOMAIN = "langwatch.localhost";
const HUB_URL = `https://hub.${DOMAIN}`;
const GB = 1024 ** 3;

const ago = ({ now, seconds }: { now: number; seconds: number }) =>
  isoOf({ ms: now - seconds * 1000 });

type SurfaceSeed = Pick<Surface, "name" | "role" | "status"> & { port?: number; hint?: string };

const surface = ({ slug, seed }: { slug: string; seed: SurfaceSeed }): Surface => {
  const routed = seed.name !== "worker";
  let hostname = "";
  if (routed) {
    hostname = seed.name === "observability" ? `observability.${DOMAIN}` : `${seed.name}.${slug}.${DOMAIN}`;
  }
  return {
    name: seed.name,
    role: seed.role,
    hostname,
    url: hostname === "" ? "" : `https://${hostname}`,
    port: seed.port ?? 0,
    status: seed.status,
    hint: seed.hint ?? "",
    fallback: false,
  };
};

const LIVE_SEEDS: SurfaceSeed[] = [
  { name: "app", role: "Browser app", status: "live", port: 5560 },
  { name: "api", role: "API", status: "live", port: 6560 },
  { name: "worker", role: "Worker: queues, projections, subscribers", status: "starting", port: 9464 },
  { name: "gateway", role: "AI gateway", status: "live", port: 7560 },
  { name: "nlp", role: "NLP service", status: "down", port: 7561 },
  { name: "langyagent", role: "Langy agent", status: "not-selected", hint: "haven up +langy" },
  { name: "idp", role: "IdP simulator", status: "live", port: 7562 },
  { name: "mail", role: "Mail sink", status: "live", port: 7563 },
  {
    name: "design-system",
    role: "Design system Storybook",
    status: "not-selected",
    hint: "haven up +design-system",
  },
  { name: "mail-room", role: "Mail room", status: "not-selected", hint: "haven up +mail-room" },
  { name: "observability", role: "Grafana, shared by every stack", status: "live", port: 3000 },
];

export const surfacesFor = ({
  slug,
  status,
}: {
  slug: string;
  status?: Surface["status"];
}): Surface[] =>
  LIVE_SEEDS.map((seed) =>
    surface({ slug, seed: status === undefined ? seed : { ...seed, status, hint: "" } }),
  );

const factsFor = ({ slug, live, now }: { slug: string; live: boolean; now: number }) => ({
  branch: `feat/${slug}-stack-home`,
  worktreeDir: `/Users/someone/Source/github.com/langwatch/langwatch/.worktrees/${slug}`,
  layout: "modular",
  baseline: false,
  uptimeSeconds: live ? 4 * 3600 + 12 * 60 : 0,
  rssBytes: live ? 3.4 * GB : 0,
  heartbeatAt: live ? ago({ now, seconds: 4 }) : null,
  databases: {
    postgres: { name: `lw_${slug.replaceAll("-", "_")}`, port: live ? 5432 : 0 },
    clickhouse: { name: `lw_${slug.replaceAll("-", "_")}`, port: live ? 8123 : 0 },
    redis: { db: live ? 3 : null, port: live ? 6379 : 0 },
  },
});

const errorLine = ({ now, seconds, service, text }: { now: number; seconds: number; service: string; text: string }): CapturedLine => ({
  at: ago({ now, seconds }),
  service,
  level: "error",
  text,
});

export const liveHome = ({ now, surfaces }: { now: number; surfaces?: Surface[] }): StackHome => ({
  slug: "feat-x",
  registered: true,
  live: true,
  hubUrl: HUB_URL,
  homeUrl: `https://feat-x.${DOMAIN}`,
  facts: factsFor({ slug: "feat-x", live: true, now }),
  surfaces: surfaces ?? surfacesFor({ slug: "feat-x" }),
  errors: [
    {
      lane: "api",
      logsUrl: `${HUB_URL}/logs/feat-x/api`,
      lines: [
        errorLine({ now, seconds: 40, service: "api", text: 'msg="request failed" route=/api/traces status=500 err="connect ECONNREFUSED 127.0.0.1:8123"' }),
        errorLine({ now, seconds: 300, service: "api", text: 'msg="clickhouse query timed out" query_id=4f1c elapsed_ms=30000' }),
      ],
    },
    {
      lane: "worker",
      logsUrl: `${HUB_URL}/logs/feat-x/worker`,
      lines: [errorLine({ now, seconds: 90, service: "worker", text: 'msg="projection stalled" projection=trace-summary lag=412' })],
    },
  ],
  credentials: {
    login: { email: "admin@langwatch.localhost" },
    mailAddress: `feat-x@mail.${DOMAIN}`,
    idpTenants: [{ id: "acme", domain: "acme.test", url: `https://idp.feat-x.${DOMAIN}/acme` }],
    apiKey: { masked: "sk-lw-••••••••9f3a", revealPath: "/api/stacks/feat-x/api-key" },
  },
  actions: { canRestart: true, canStart: false, startDir: factsFor({ slug: "feat-x", live: true, now }).worktreeDir },
});

export const stoppedHome = ({ now }: { now: number }): StackHome => {
  const facts = factsFor({ slug: "stopped", live: false, now });
  return {
    slug: "stopped",
    registered: false,
    live: false,
    hubUrl: HUB_URL,
    homeUrl: `https://stopped.${DOMAIN}`,
    facts,
    surfaces: surfacesFor({ slug: "stopped", status: "down" }),
    errors: [],
    credentials: {
      login: { email: "admin@langwatch.localhost" },
      mailAddress: `stopped@mail.${DOMAIN}`,
      idpTenants: [],
      apiKey: null,
    },
    actions: { canRestart: false, canStart: true, startDir: facts.worktreeDir },
  };
};

export const notFound = ({ slug }: { slug: string }): NotFound => ({
  error: `no stack is registered for "${slug}"`,
  slug,
  hubUrl: HUB_URL,
});

const hubStack = ({ home, appUrl }: { home: StackHome; appUrl: string }): HubStack => ({
  slug: home.slug,
  live: home.live,
  homeUrl: home.homeUrl,
  appUrl,
  facts: home.facts,
  surfaces: home.surfaces,
  canRestart: home.actions.canRestart,
});

export const hub = ({ now }: { now: number }): Hub => {
  const feat = liveHome({ now });
  const long = {
    ...liveHome({ now }),
    slug: "issue4821-a-rather-long-worktree-name",
    live: false,
    homeUrl: `https://issue4821-a-rather-long-worktree-name.${DOMAIN}`,
    surfaces: surfacesFor({ slug: "issue4821-a-rather-long-worktree-name", status: "down" }),
    actions: { canRestart: false, canStart: false, startDir: "" },
  };
  return {
    shared: {
      hubUrl: HUB_URL,
      observabilityUrl: `https://observability.${DOMAIN}`,
      telemetryUrl: `https://telemetry.${DOMAIN}`,
    },
    machine: {
      totalRamBytes: 32 * GB,
      devRssBytes: 14.2 * GB,
      stacksRssBytes: 6.8 * GB,
      serverRssBytes: { clickhouse: 1.9 * GB, postgres: 0.4 * GB, redis: 0.05 * GB, containers: 2.1 * GB },
      agentRssBytes: 2.2 * GB,
      agentCount: 3,
      toolingRssBytes: 0.75 * GB,
      otherRssBytes: 9.6 * GB,
      pressure: "amber",
    },
    stacks: [hubStack({ home: feat, appUrl: `https://app.feat-x.${DOMAIN}` }), hubStack({ home: long, appUrl: "" })],
    worktrees: [
      { name: "langwatch", slug: "", branch: "main", dir: "/Users/someone/Source/github.com/langwatch/langwatch", isPrimary: true, isCurrent: false, homeUrl: "", canStart: true },
      { name: "stopped", slug: "stopped", branch: "feat/stopped-stack-home", dir: "/Users/someone/Source/github.com/langwatch/langwatch/.worktrees/stopped", isPrimary: false, isCurrent: true, homeUrl: `https://stopped.${DOMAIN}`, canStart: true },
    ],
    events: [
      { at: ago({ now, seconds: 120 }), kind: "stack", target: "old-branch", reason: "launcher exited 2h ago" },
      { at: ago({ now, seconds: 3600 }), kind: "container", target: "testcontainers-clickhouse-81f2", reason: "idle past HAVEN_IDLE_TTL" },
      { at: null, kind: "database", target: "lw_retired_branch", reason: "worktree not up for 4 days" },
    ],
    actions: { canRestart: true, canStart: true },
  };
};

const LOG_TEXTS: [string, string, string][] = [
  ["api", "info", 'msg="GET /api/health" status=200 duration_ms=3'],
  ["app", "info", "vite ready in 812 ms"],
  ["worker", "debug", 'msg="drained queue" queue=evaluations jobs=0'],
  ["api", "warn", 'msg="slow query" elapsed_ms=1840 table=traces'],
  ["worker", "info", 'msg="projection caught up" projection=trace-summary'],
  ["api", "error", 'msg="request failed" route=/api/traces status=500 err="connect ECONNREFUSED 127.0.0.1:8123"'],
  ["gateway", "info", 'msg="provider warmed" provider=openai'],
  ["api", "info", 'msg="<script>alert(1)</script> echoed in a query string"'],
  ["worker", "fatal", 'msg="lost the redis connection" attempts=5'],
  ["app", "", "  ➜  Local:   http://localhost:5560/"],
];

export const logs = ({ now, lane = "" }: { now: number; lane?: string }): Logs => {
  const lines: CapturedLine[] = [];
  for (let index = 0; index < 60; index += 1) {
    const [service, level, text] = LOG_TEXTS[index % LOG_TEXTS.length] ?? ["api", "info", ""];
    if (lane === "" || lane === service) {
      lines.push({ at: ago({ now, seconds: (60 - index) * 7 }), service, level, text });
    }
  }
  return { lines, services: ["api", "app", "gateway", "worker"], limit: 1000 };
};
