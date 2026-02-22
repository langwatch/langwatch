/**
 * Continuous multi-org trace simulation via TraceRequestCollectionService.
 *
 * Sends OTEL traces directly into the event sourcing pipeline for seeded
 * test organizations. One org is designated the "whale" and receives the
 * majority of traffic to simulate realistic billing skew.
 *
 * Prerequisites:
 *   1. Run the seed script:  psql "$DATABASE_URL" -f langwatch/scripts/seed-subscription-test-organizations.sql
 *   2. Redis + ClickHouse must be running (event sourcing pipeline)
 *
 * Environment variables:
 *   ROUNDS                   — number of rounds (default 10, 0 = infinite)
 *   TRACES_PER_ROUND         — traces per round across all orgs (default 50)
 *   WHALE_RATIO              — fraction of traces for the whale org (default 0.6)
 *   DELAY_BETWEEN_ROUNDS_MS  — pause between rounds in ms (default 1000)
 *   WHALE_ORG_SLUG           — override whale org slug
 *
 * Usage:
 *   pnpm test:stress --run -t "multi-org"
 *   ROUNDS=100 TRACES_PER_ROUND=200 pnpm test:stress --run -t "multi-org"
 */

import { nanoid } from "nanoid";
import { mean, median, standardDeviation } from "simple-statistics";
import { beforeAll, describe, expect, test } from "vitest";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { prisma } from "../../server/db";
import { TraceRequestCollectionService } from "../../server/traces/trace-request-collection.service";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROUNDS = parseInt(process.env.ROUNDS ?? "10");
const TRACES_PER_ROUND = parseInt(process.env.TRACES_PER_ROUND ?? "50");
const WHALE_RATIO = parseFloat(process.env.WHALE_RATIO ?? "0.6");
const DELAY_BETWEEN_ROUNDS_MS = parseInt(
  process.env.DELAY_BETWEEN_ROUNDS_MS ?? "1000",
);

const SEED_ORG_SLUGS = [
  "test-tiered-free-upgrade-ready",
  "test-tiered-free-restricted",
  "test-seat-event-free-upgrade-ready",
  "test-seat-event-free-restricted",
  "test-tiered-growth-paid-upgrade-ready-no-sub-id",
  "test-tiered-growth-paid-restricted-no-sub-id",
  "test-tiered-custom-paid-upgrade-ready-no-sub-id",
  "test-tiered-custom-paid-restricted-no-sub-id",
];

const WHALE_ORG_SLUG =
  process.env.WHALE_ORG_SLUG ??
  "test-tiered-growth-paid-restricted-no-sub-id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OrgProject {
  id: string;
  slug: string;
  orgSlug: string;
  orgName: string;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
}

function printStats(responseTimes: number[]) {
  const sortedTimes = [...responseTimes].sort((a, b) => a - b);
  const stats = {
    min: sortedTimes[0],
    max: sortedTimes[sortedTimes.length - 1],
    mean: mean(sortedTimes),
    median: median(sortedTimes),
    p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)],
    p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)],
    stdDev: standardDeviation(sortedTimes),
  };

  console.log("  Response times (ms):");
  console.table(stats);
}

function makeOtelTraceId(): string {
  return nanoid(16)
    .split("")
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function buildOtelPayload(
  serviceName: string,
): IExportTraceServiceRequest {
  const traceIdHex = makeOtelTraceId();
  const spanIdHex = traceIdHex.slice(0, 16);
  const nowNs = `${Date.now()}000000`;

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: serviceName },
            spans: [
              {
                traceId: traceIdHex,
                spanId: spanIdHex,
                name: "llm.openai.chat",
                kind: 3,
                startTimeUnixNano: nowNs,
                endTimeUnixNano: `${Date.now() + 100}000000`,
                attributes: [
                  {
                    key: "gen_ai.system",
                    value: { stringValue: "openai" },
                  },
                  {
                    key: "gen_ai.request.model",
                    value: { stringValue: "gpt-5" },
                  },
                  {
                    key: "gen_ai.prompt.0.role",
                    value: { stringValue: "user" },
                  },
                  {
                    key: "gen_ai.prompt.0.content",
                    value: {
                      stringValue: `simulated trace ${nanoid()}`,
                    },
                  },
                  {
                    key: "gen_ai.completion.0.role",
                    value: { stringValue: "assistant" },
                  },
                  {
                    key: "gen_ai.completion.0.content",
                    value: { stringValue: `response ${nanoid()}` },
                  },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  } as IExportTraceServiceRequest;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("OTEL multi-org trace simulation", () => {
  let projects: OrgProject[];
  let whaleProject: OrgProject;
  let normalProjects: OrgProject[];

  beforeAll(async () => {
    const dbProjects = await prisma.project.findMany({
      where: {
        team: {
          organization: {
            slug: { in: SEED_ORG_SLUGS },
          },
        },
      },
      include: {
        team: {
          include: { organization: true },
        },
      },
    });

    projects = dbProjects.map((p) => ({
      id: p.id,
      slug: p.slug,
      orgSlug: p.team.organization!.slug,
      orgName: p.team.organization!.name,
      piiRedactionLevel: p.piiRedactionLevel,
    }));

    if (projects.length === 0) {
      throw new Error(
        "No seeded projects found. Run seed-subscription-test-organizations.sql first.",
      );
    }

    const whale = projects.find((p) => p.orgSlug === WHALE_ORG_SLUG);
    if (!whale) {
      throw new Error(
        `Whale org "${WHALE_ORG_SLUG}" not found among seeded projects: ${projects.map((p) => p.orgSlug).join(", ")}`,
      );
    }
    whaleProject = whale;
    normalProjects = projects.filter((p) => p.orgSlug !== WHALE_ORG_SLUG);

    console.log("\n--- Simulation Config ---");
    console.log(`  Rounds:          ${ROUNDS === 0 ? "infinite" : ROUNDS}`);
    console.log(`  Traces/round:    ${TRACES_PER_ROUND}`);
    console.log(`  Whale ratio:     ${(WHALE_RATIO * 100).toFixed(0)}%`);
    console.log(`  Delay between:   ${DELAY_BETWEEN_ROUNDS_MS}ms`);
    console.log(`  Whale org:       ${whaleProject.orgName} (${whaleProject.orgSlug})`);
    console.log(`  Normal orgs:     ${normalProjects.length}`);
    console.log(
      `  All orgs:        ${projects.map((p) => p.orgSlug).join(", ")}`,
    );
    console.log("-------------------------\n");
  });

  test("simulates continuous trace traffic across seeded orgs", async () => {
    const service = new TraceRequestCollectionService();
    const totalCounts = new Map<string, number>();

    const maxRounds = ROUNDS === 0 ? Number.MAX_SAFE_INTEGER : ROUNDS;

    for (let round = 0; round < maxRounds; round++) {
      const whaleCount = Math.floor(TRACES_PER_ROUND * WHALE_RATIO);
      const normalCount = TRACES_PER_ROUND - whaleCount;

      // Build round assignments: whale gets WHALE_RATIO, rest split evenly
      const assignments: OrgProject[] = [];
      for (let i = 0; i < whaleCount; i++) {
        assignments.push(whaleProject);
      }
      for (let i = 0; i < normalCount; i++) {
        assignments.push(normalProjects[i % normalProjects.length]!);
      }
      shuffle(assignments);

      // Track per-org counts for this round
      const roundCounts = new Map<string, number>();

      const responseTimes = await Promise.all(
        assignments.map(async (proj) => {
          const payload = buildOtelPayload(`sim-${proj.orgSlug}`);

          const start = Date.now();
          await service.handleOtlpTraceRequest(
            proj.id,
            payload,
            proj.piiRedactionLevel,
          );
          const elapsed = Date.now() - start;

          roundCounts.set(proj.orgSlug, (roundCounts.get(proj.orgSlug) ?? 0) + 1);
          totalCounts.set(proj.orgSlug, (totalCounts.get(proj.orgSlug) ?? 0) + 1);

          return elapsed;
        }),
      );

      // Print round summary
      const roundCountStr = [...roundCounts.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([slug, count]) => `${slug}=${count}`)
        .join(", ");

      console.log(
        `\nRound ${round + 1}/${ROUNDS === 0 ? "inf" : ROUNDS} — ${assignments.length} traces (${roundCountStr})`,
      );
      printStats(responseTimes);

      if (round < maxRounds - 1 && DELAY_BETWEEN_ROUNDS_MS > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_ROUNDS_MS),
        );
      }
    }

    // Final summary
    const totalTraces = [...totalCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`\n=== Simulation Complete ===`);
    console.log(`Total traces sent: ${totalTraces}`);
    console.log("Per-org breakdown:");
    for (const [slug, count] of [...totalCounts.entries()].sort(
      ([, a], [, b]) => b - a,
    )) {
      console.log(
        `  ${slug}: ${count} (${((count / totalTraces) * 100).toFixed(1)}%)`,
      );
    }

    expect(totalTraces).toBeGreaterThan(0);
  });
});
