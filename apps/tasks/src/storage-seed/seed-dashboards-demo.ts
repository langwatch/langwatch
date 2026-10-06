/**
 * Dashboards demo seed: identity rows into the database, then 30 days of traffic through
 * the stack's own collector and event doors. Re-runs repeat every id. Run lwql-provision
 * after: projects written to the database miss the event that adds their LangWatchQL key.
 */
import { createLogger } from "@langwatch/observability";

import type { TaskInput } from "../config.ts";
import { findDemoMember, seedDashboardsDemoIdentity } from "./dashboards-demo-identity.ts";
import { DASHBOARDS_DEMO_PROJECTS } from "./dashboards-demo-ids.ts";
import { DASHBOARDS_DEMO_PROJECT_SPECS } from "./dashboards-demo-projects.generated.ts";
import {
  conversationTurns,
  demoConversationsPerDay,
  type DemoTurn,
} from "./dashboards-demo-traffic.ts";

const logger = createLogger("langwatch:tasks:dashboards-demo-seed");

const DAY_MS = 86_400_000;
const DEFAULT_ENDPOINT = "http://localhost:6560";
const DEFAULT_DAYS = 30;
const CONCURRENCY = 12;
const ATTEMPTS = 4;
/** More refusals than this means the stack or the payload is wrong; stop rather than flood. */
const MAX_FAILURES = 25;

export async function seedDashboardsDemo({
  connections,
  environment,
  signal,
}: TaskInput): Promise<void> {
  const database = connections.database;
  if (!database) throw new Error("This task needs DATABASE_URL");
  const prisma = database.client;
  const endpoint = (
    environment.DASHBOARDS_DEMO_ENDPOINT ??
    environment.HAVEN_SEED_ENDPOINT ??
    DEFAULT_ENDPOINT
  ).replace(/\/$/, "");
  const days = Number(environment.DASHBOARDS_DEMO_DAYS ?? DEFAULT_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error("DASHBOARDS_DEMO_DAYS must be a whole number from 1 to 90");
  }

  const member = await findDemoMember({ prisma, email: environment.DASHBOARDS_DEMO_USER_EMAIL });
  await seedDashboardsDemoIdentity({ prisma, userId: member.id });
  logger.info(
    { member: member.email, projects: DASHBOARDS_DEMO_PROJECTS.length },
    "seeded the dashboards demo organization",
  );

  await assertReachable({ endpoint });
  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  for (const project of DASHBOARDS_DEMO_PROJECTS) {
    signal.throwIfAborted();
    const spec = DASHBOARDS_DEMO_PROJECT_SPECS.find(
      (candidate) => candidate.archetype === project.archetype,
    );
    if (!project.archetype || !spec) continue;
    const turns: DemoTurn[] = [];
    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
      const dayStart = todayStart - daysAgo * DAY_MS;
      const date = new Date(dayStart).toISOString().slice(0, 10);
      const conversations = demoConversationsPerDay({ spec, date: new Date(dayStart) });
      for (let index = 0; index < conversations; index++) {
        for (const turn of conversationTurns({
          spec,
          projectSlug: project.slug,
          date,
          index,
          dayStart,
          todayStart,
        })) {
          if (turn.body.spans.every((span) => span.timestamps.finished_at <= now)) {
            turns.push(turn);
          }
        }
      }
    }
    const sender = new DemoSender({ endpoint, apiKey: project.apiKey, signal });
    await sender.sendAll({
      path: "/api/collector",
      bodies: turns.map((turn) => turn.body),
    });
    const events = turns
      .flatMap((turn) => turn.events)
      .filter((event) => (event.timestamp ?? 0) <= now);
    await sender.sendAll({ path: "/api/track_event", bodies: events });
    logger.info(
      {
        project: project.slug,
        traces: turns.length,
        evaluations: turns.reduce((sum, turn) => sum + (turn.body.evaluations?.length ?? 0), 0),
        thumbsEvents: events.length,
        refused: sender.failures,
      },
      "sent the project's demo traffic",
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

/** Posts bodies to one door with one project key: a few at a time, retrying what may pass later. */
class DemoSender {
  failures = 0;

  constructor(
    private readonly options: { endpoint: string; apiKey: string; signal: AbortSignal },
  ) {}

  async sendAll({ path, bodies }: { path: string; bodies: readonly unknown[] }): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < bodies.length) {
        this.options.signal.throwIfAborted();
        const body = bodies[next++];
        await this.send({ path, body });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  private async send({ path, body }: { path: string; body: unknown }): Promise<void> {
    let lastProblem = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await fetch(`${this.options.endpoint}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Auth-Token": this.options.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return;
        lastProblem = `${response.status} ${(await response.text()).slice(0, 300)}`;
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    this.failures++;
    logger.warn({ path, problem: lastProblem }, "the stack refused a demo body");
    if (this.failures > MAX_FAILURES) {
      throw new Error(`Stopped after ${this.failures} refusals; the last was: ${lastProblem}`);
    }
  }
}
