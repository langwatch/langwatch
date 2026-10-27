/**
 * Dashboards demo seed: identity rows into the database, then 60 days of traffic through the
 * stack's own doors, traces for the last 30 only. A re-run sends only what a project does not
 * hold yet. Run lwql-provision after: its projects miss the event that adds their query key.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";

import type { TaskInput } from "../config.ts";
import { withTasksApp } from "../module-task.ts";
import { codingSessionsOn } from "./dashboards-demo-coding.ts";
import { type DemoDay, demoDays } from "./dashboards-demo-days.ts";
import { DEMO_EXPERIMENTS, experimentRunOn } from "./dashboards-demo-experiments.ts";
import { ensureVirtualKey, sendSpend, spendRecordsFor } from "./dashboards-demo-gateway.ts";
import { DemoHttp } from "./dashboards-demo-http.ts";
import { findDemoMember, seedDashboardsDemoIdentity } from "./dashboards-demo-identity.ts";
import {
  DASHBOARDS_DEMO_ORGANIZATION,
  DASHBOARDS_DEMO_PROJECTS,
  type DashboardsDemoAgent,
  type DashboardsDemoProject,
} from "./dashboards-demo-ids.ts";
import { langyMirrorTurnsOn, langyTurnsAskedIn } from "./dashboards-demo-langy.ts";
import { otlpResourceSpans } from "./dashboards-demo-otlp.ts";
import { DASHBOARDS_DEMO_PROJECT_SPECS } from "./dashboards-demo-projects.generated.ts";
import { seedPromptHistory } from "./dashboards-demo-prompts.ts";
import { reviewedOf, seedReviewerThumbs, seedReviewQueue } from "./dashboards-demo-reviews.ts";
import { DEMO_SUITES, suiteBatchOn } from "./dashboards-demo-scenarios.ts";
import { dashboardsDemoSettings } from "./dashboards-demo-settings.ts";
import type { DashboardsDemoProjectSpec } from "./dashboards-demo-spec.ts";
import { storedIds, storedTraceIds } from "./dashboards-demo-stored.ts";
import { withStory } from "./dashboards-demo-story.ts";
import {
  conversationTurns,
  demoConversationsPerDay,
  demoTracesPerDay,
  type DemoTurn,
} from "./dashboards-demo-traffic.ts";

const logger = createLogger("langwatch:tasks:dashboards-demo-seed");

const DAY_MS = 86_400_000;
/** Traces in one OTLP export; an SDK batches the same way. */
const OTLP_BATCH = 25;
/**
 * Every trace door drops a span that started more than 31 days ago (SPAN_MAX_PAST_MS), so
 * older days send only what other doors accept: gateway spend, scenario runs, coding logs.
 */
const TRACE_DOOR_DAYS = 30;
const DAY_MS_FOR_TRACES = TRACE_DOOR_DAYS * DAY_MS;
/**
 * The stack drops scenario runs and coding sessions older than a project's retention, 49 days
 * unless set (PLATFORM_DEFAULT_RETENTION_DAYS), so an older one would be sent again by every run.
 */
const RETAINED_DAYS = 48;

/** Agents in these projects call their models through the gateway. */
const GATEWAY_PROJECTS = new Set(["dashboards-demo-care", "dashboards-demo-platform"]);

/** Members of these projects ask Langy, so its turns sit beside their agents' traces. */
const LANGY_ASKED_IN = new Set(["dashboards-demo-care"]);
/** Langy's turns in such a project, as a share of the traces its agents send each day. */
const LANGY_SHARE = 0.05;

/** One run's facts, fixed when it starts: where the stack is, how much to send, and its clock. */
export interface DashboardsDemoRun {
  prisma: PrismaClient;
  endpoint: string;
  signal: AbortSignal;
  days: number;
  scale: number;
  now: number;
  todayStart: number;
  gatewaySecret: string | undefined;
}

export async function seedDashboardsDemo({
  config,
  connections,
  chain,
  environment,
  signal,
}: TaskInput): Promise<void> {
  // First, so a production deployment or a remote endpoint is refused before any row is written.
  const { endpoint, days, size, scale, userEmail } = dashboardsDemoSettings({
    environment,
    config,
  });
  const database = connections.database;
  if (!database) throw new Error("This task needs DATABASE_URL");
  const prisma = database.client;

  const member = await findDemoMember({ prisma, email: userEmail });
  // The grants are authz commands, so the tasks app boots to send them, as the storage seed does.
  await withTasksApp({
    use: (app) =>
      seedDashboardsDemoIdentity({ prisma, authz: app.service(AuthzApi), userId: member.id }),
  });
  logger.info(
    { member: member.email, projects: DASHBOARDS_DEMO_PROJECTS.length, size, days },
    "seeded the dashboards demo organization",
  );

  await assertReachable({ endpoint });
  const now = nowInstant().epochMilliseconds;
  // The secret the gateway signs its spend drain with; the seed drains as the gateway does.
  const gatewaySecret = await chain.fetch("LW_GATEWAY_INTERNAL_SECRET");
  if (!gatewaySecret) {
    logger.warn("LW_GATEWAY_INTERNAL_SECRET is unset, so no gateway spend is sent");
  }
  await sendDashboardsDemoTraffic({
    run: {
      prisma,
      endpoint,
      signal,
      days,
      scale,
      now,
      todayStart: Math.floor(now / DAY_MS) * DAY_MS,
      gatewaySecret,
    },
    langyMirror: {
      projectId: await chain.fetch("LANGY_MIRROR_PROJECT_ID"),
      apiKey: await chain.fetch("LANGY_MIRROR_TRACE_KEY"),
    },
  });
}

/** Everything a run sends through the stack's doors, once its identity rows exist. */
export async function sendDashboardsDemoTraffic({
  run,
  langyMirror,
}: {
  run: DashboardsDemoRun;
  /** The project the Langy mirror lane writes to and its key, when the stack has one. */
  langyMirror: { projectId: string | undefined; apiKey: string | undefined };
}): Promise<void> {
  for (const project of DASHBOARDS_DEMO_PROJECTS) {
    run.signal.throwIfAborted();
    await seedProject({ run, project });
  }
  await seedLangyHistory({ run, ...langyMirror });
}

/**
 * History for the project the Langy mirror lane writes to, when one is set, so its boards
 * show past turns beside the live ones. The key is the mirror's own, as the live lane uses.
 * Turns are traces, so the history is as long as the trace door allows and no longer.
 */
async function seedLangyHistory({
  run,
  projectId,
  apiKey,
}: {
  run: DashboardsDemoRun;
  projectId: string | undefined;
  apiKey: string | undefined;
}): Promise<void> {
  if (!projectId || !apiKey) {
    logger.info("no Langy mirror project is set, so no Langy history is sent");
    return;
  }
  const http = new DemoHttp({ endpoint: run.endpoint, apiKey, signal: run.signal });
  const { team } = await run.prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const turns = daysOf(run)
    .flatMap((day) =>
      langyMirrorTurnsOn({
        projectId,
        organizationId: team.organizationId,
        day,
        scale: run.scale,
        now: run.now,
      }),
    )
    .filter((turn) => inTraceDoor({ run, at: turn.finishedAt }));
  const stored = await storedTraceIds({ http, now: run.now });
  const fresh = turns.filter((turn) => !stored.has(turn.traceId));
  await http.sendAll({ path: "/api/otel/v1/traces", bodies: fresh.map((turn) => turn.export) });
  const thumbs = await seedReviewerThumbs({
    http,
    prisma: run.prisma,
    projectId,
    reviewed: turns.map(({ traceId, finishedAt, failed }) => ({
      traceId,
      finishedAt,
      passed: !failed,
    })),
  });
  logger.info(
    {
      projectId,
      historyDays: TRACE_DOOR_DAYS,
      turns: fresh.length,
      alreadyHeld: turns.length - fresh.length,
      thumbs,
      refused: http.failures,
    },
    "sent Langy history; the trace door keeps no trace older than 31 days",
  );
}

async function seedProject({
  run,
  project,
}: {
  run: DashboardsDemoRun;
  project: DashboardsDemoProject;
}): Promise<void> {
  // The day-zero project gets no traffic, so there is nothing to ask of it or to send.
  if (project.agents.length === 0) return;
  const http = new DemoHttp({ endpoint: run.endpoint, apiKey: project.apiKey, signal: run.signal });
  const held = await storedTraceIds({ http, now: run.now });
  const spendSecret = GATEWAY_PROJECTS.has(project.id) ? run.gatewaySecret : undefined;
  // A request still only admitted is sent again, so its outcome can land.
  const heldSpend = spendSecret
    ? await storedIds({ http, view: "gateway_request_spend", where: "Status != 'admitted'" })
    : new Set<string>();
  const projectTurns: DemoTurn[] = [];
  for (const agent of project.agents) {
    if (agent.shape === "coding") {
      await sendCodingSessions({ run, http, project, agent, held });
      continue;
    }
    const spec = specOf(agent);
    const turns = agentTurns({ run, project, agent, spec });
    const traced = turns.filter((turn) => inTraceDoor({ run, at: startOf(turn.body) }));
    const fresh = traced.filter((turn) => !held.has(turn.body.trace_id ?? ""));
    projectTurns.push(...traced);
    await sendTurns({ http, agent, turns: fresh, now: run.now });
    const prompts = await seedPromptHistory({
      http,
      prisma: run.prisma,
      projectId: project.id,
      agentName: agent.name,
      spec,
      days: run.days,
      todayStart: run.todayStart,
    });
    const spend = spendSecret
      ? await sendGatewaySpend({
          http,
          project,
          agent,
          turns,
          secret: spendSecret,
          held: heldSpend,
        })
      : 0;
    logger.info(
      {
        project: project.slug,
        agent: agent.name,
        traces: fresh.length,
        alreadyHeld: traced.length - fresh.length,
        prompts,
        spend,
      },
      "sent the agent's demo traffic",
    );
  }
  if (LANGY_ASKED_IN.has(project.id)) await sendLangyTurnsAskedIn({ run, http, project, held });
  await sendScenarioRuns({ run, http, project, held });
  await sendExperimentRuns({ run, http, project });
  if (projectTurns.length > 0) {
    const thumbs = await seedReviewerThumbs({
      http,
      prisma: run.prisma,
      projectId: project.id,
      reviewed: projectTurns.map(reviewedOf),
    });
    const queued = await seedReviewQueue({
      prisma: run.prisma,
      projectId: project.id,
      turns: projectTurns,
      now: run.now,
    });
    logger.info({ project: project.slug, thumbs, queued }, "seeded the project's reviews");
  }
  if (http.failures > 0) {
    logger.warn({ project: project.slug, refused: http.failures }, "the stack refused some bodies");
  }
}

const startOf = (body: DemoTurn["body"]): number =>
  Math.min(...body.spans.map((span) => span.timestamps.started_at));

/** Whether a trace of that time is young enough for the trace door to keep it. */
const inTraceDoor = ({ run, at }: { run: DashboardsDemoRun; at: number }): boolean =>
  at >= run.now - DAY_MS_FOR_TRACES;

/** Whether a run or session of that time is young enough for the stack to keep it. */
const isRetained = ({ run, at }: { run: DashboardsDemoRun; at: number }): boolean =>
  at >= run.now - RETAINED_DAYS * DAY_MS;

function specOf(agent: DashboardsDemoAgent): DashboardsDemoProjectSpec {
  const spec = DASHBOARDS_DEMO_PROJECT_SPECS.find(
    (candidate) => candidate.archetype === agent.archetype,
  );
  if (!spec) throw new Error(`No traffic spec for the demo agent ${agent.name}`);
  return withStory({ spec, agentName: agent.name });
}

/** The run's days, oldest first, ending today. */
const daysOf = (run: DashboardsDemoRun): DemoDay[] =>
  demoDays({ days: run.days, todayStart: run.todayStart });

function agentTurns({
  run,
  project,
  agent,
  spec,
}: {
  run: DashboardsDemoRun;
  project: DashboardsDemoProject;
  agent: DashboardsDemoAgent;
  spec: DashboardsDemoProjectSpec;
}): DemoTurn[] {
  const turns: DemoTurn[] = [];
  for (const day of daysOf(run)) {
    const conversations = demoConversationsPerDay({ spec, agent, day, scale: run.scale });
    for (let index = 0; index < conversations; index++) {
      for (const turn of conversationTurns({
        spec,
        agent,
        projectSlug: project.slug,
        demoDay: day,
        index,
      })) {
        // Traffic from later today has not happened yet.
        if (turn.body.spans.every((span) => span.timestamps.finished_at <= run.now)) {
          turns.push(turn);
        }
      }
    }
  }
  return turns;
}

/** Spans over OTLP in batches, then each trace's evaluations and thumbs through their doors. */
async function sendTurns({
  http,
  agent,
  turns,
  now,
}: {
  http: DemoHttp;
  agent: DashboardsDemoAgent;
  turns: readonly DemoTurn[];
  now: number;
}): Promise<void> {
  const exports: object[] = [];
  for (let start = 0; start < turns.length; start += OTLP_BATCH) {
    exports.push({
      resourceSpans: turns
        .slice(start, start + OTLP_BATCH)
        .map((turn) => otlpResourceSpans({ serviceName: agent.name, body: turn.body })),
    });
  }
  await http.sendAll({ path: "/api/otel/v1/traces", bodies: exports });
  await http.sendAll({
    path: "/api/collector",
    bodies: turns
      .filter((turn) => (turn.body.evaluations?.length ?? 0) > 0)
      .map((turn) => ({
        trace_id: turn.body.trace_id,
        spans: [],
        evaluations: turn.body.evaluations,
      })),
  });
  await http.sendAll({
    path: "/api/track_event",
    bodies: turns.flatMap((turn) => turn.events).filter((event) => (event.timestamp ?? 0) <= now),
  });
}

/**
 * Langy's own turns asked from inside the project, a share of the traces its agents send each
 * day, so they sit beside those traces as they do in a real project.
 */
async function sendLangyTurnsAskedIn({
  run,
  http,
  project,
  held,
}: {
  run: DashboardsDemoRun;
  http: DemoHttp;
  project: DashboardsDemoProject;
  held: ReadonlySet<string>;
}): Promise<void> {
  const agents = project.agents.filter(({ shape }) => shape !== "coding");
  const turns = daysOf(run)
    .flatMap((day) => {
      const traces = agents.reduce(
        (sum, agent) =>
          sum + demoTracesPerDay({ spec: specOf(agent), agent, day, scale: run.scale }),
        0,
      );
      return langyTurnsAskedIn({
        projectId: project.id,
        day,
        count: Math.round(traces * LANGY_SHARE),
        now: run.now,
      });
    })
    .filter((turn) => inTraceDoor({ run, at: turn.finishedAt }));
  const fresh = turns.filter((turn) => !held.has(turn.traceId));
  await http.sendAll({ path: "/api/otel/v1/traces", bodies: fresh.map((turn) => turn.export) });
  logger.info(
    { project: project.slug, turns: fresh.length, alreadyHeld: turns.length - fresh.length },
    "sent Langy turns asked from inside the project",
  );
}

/** A session's logs go once, since the session fold adds a repeat; so do its traces. */
async function sendCodingSessions({
  run,
  http,
  project,
  agent,
  held,
}: {
  run: DashboardsDemoRun;
  http: DemoHttp;
  project: DashboardsDemoProject;
  agent: DashboardsDemoAgent;
  held: ReadonlySet<string>;
}): Promise<void> {
  const sessions = daysOf(run)
    .flatMap((day) =>
      codingSessionsOn({ agent, projectSlug: project.slug, day, scale: run.scale, now: run.now }),
    )
    .filter(({ startedAt }) => isRetained({ run, at: startedAt }));
  const heldSessions = await storedIds({ http, view: "coding_sessions" });
  const fresh = sessions.filter(({ sessionId }) => !heldSessions.has(sessionId));
  const traced = sessions.filter(
    ({ traceId, startedAt }) => inTraceDoor({ run, at: startedAt }) && !held.has(traceId),
  );
  await http.sendAll({
    path: "/api/otel/v1/traces",
    bodies: traced.flatMap(({ traces }) => traces),
  });
  await http.sendAll({ path: "/api/otel/v1/logs", bodies: fresh.flatMap(({ logs }) => logs) });
  logger.info(
    {
      project: project.slug,
      agent: agent.name,
      sessions: fresh.length,
      alreadyHeld: sessions.length - fresh.length,
    },
    "sent coding sessions",
  );
}

async function sendGatewaySpend({
  http,
  project,
  agent,
  turns,
  secret,
  held,
}: {
  http: DemoHttp;
  project: DashboardsDemoProject;
  agent: DashboardsDemoAgent;
  turns: readonly DemoTurn[];
  /** The secret the gateway signs its spend drain with. */
  secret: string;
  held: ReadonlySet<string>;
}): Promise<number> {
  const key = await ensureVirtualKey({ http, name: agent.name });
  const records = spendRecordsFor({
    turns,
    projectId: project.id,
    organizationId: DASHBOARDS_DEMO_ORGANIZATION.id,
    virtualKeyId: key.id,
    held,
  });
  await sendSpend({ http, records, secret });
  return records.length;
}

/**
 * A run goes once: its trace, then its events in order, since a run is finished only after it
 * started. A run the project holds unfinished is sent again, and the door keeps what it has.
 */
async function sendScenarioRuns({
  run,
  http,
  project,
  held,
}: {
  run: DashboardsDemoRun;
  http: DemoHttp;
  project: DashboardsDemoProject;
  held: ReadonlySet<string>;
}): Promise<void> {
  const names = new Set(project.agents.map(({ name }) => name));
  const runs = DEMO_SUITES.filter((suite) => names.has(suite.agent))
    .flatMap((suite) =>
      daysOf(run).flatMap((day) =>
        suiteBatchOn({ suite, projectSlug: project.slug, day, now: run.now }),
      ),
    )
    .filter(({ startedAt }) => isRetained({ run, at: startedAt }));
  if (runs.length === 0) return;
  const finished = await storedIds({
    http,
    view: "simulations",
    where: "Status IN ('SUCCESS', 'FAILED')",
  });
  const fresh = runs.filter(({ scenarioRunId }) => !finished.has(scenarioRunId));
  const traced = fresh.filter(
    ({ trace }) => inTraceDoor({ run, at: startOf(trace) }) && !held.has(trace.trace_id ?? ""),
  );
  await http.sendAll({
    path: "/api/otel/v1/traces",
    bodies: traced.map((scenarioRun) => ({
      resourceSpans: [
        otlpResourceSpans({ serviceName: "scenario-runner", body: scenarioRun.trace }),
      ],
    })),
  });
  await http.forEach({
    items: fresh,
    each: async (scenarioRun) => {
      for (const event of scenarioRun.events) {
        await http.send({ method: "POST", path: "/api/scenario-events", body: event });
      }
    },
  });
  logger.info(
    {
      project: project.slug,
      runs: fresh.length,
      alreadyHeld: runs.length - fresh.length,
      traces: traced.length,
    },
    "sent scenario runs",
  );
}

/** A run's results go once: the experiment door adds a repeat to the run's counts. */
async function sendExperimentRuns({
  run,
  http,
  project,
}: {
  run: DashboardsDemoRun;
  http: DemoHttp;
  project: DashboardsDemoProject;
}): Promise<void> {
  const names = new Set(project.agents.map(({ name }) => name));
  const experiments = DEMO_EXPERIMENTS.filter(({ agent }) => names.has(agent));
  if (experiments.length === 0) return;
  const heldRuns = await storedIds({ http, view: "experiment_run_results" });
  for (const experiment of experiments) {
    await http.json({
      method: "POST",
      path: "/api/experiment/init",
      body: {
        experiment_slug: experiment.slug,
        experiment_name: experiment.name,
        experiment_type: "BATCH_EVALUATION_V2",
      },
    });
    const made = daysOf(run).flatMap((day) => {
      const body = experimentRunOn({ experiment, day, now: run.now });
      return body ? [body] : [];
    });
    const fresh = made.filter((body) => !heldRuns.has(body.run_id));
    await http.sendAll({ path: "/api/evaluations/batch/log_results", bodies: fresh });
    logger.info(
      {
        project: project.slug,
        experiment: experiment.slug,
        runs: fresh.length,
        alreadyHeld: made.length - fresh.length,
      },
      "sent experiment runs",
    );
  }
}

async function assertReachable({ endpoint }: { endpoint: string }): Promise<void> {
  try {
    await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(
      `Nothing answers at ${endpoint}; start the stack, or set DASHBOARDS_DEMO_ENDPOINT to its app URL`,
    );
  }
}
