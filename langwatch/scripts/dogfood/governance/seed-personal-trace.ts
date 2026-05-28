/**
 * Fastest QA-only fixture path for a personal-workspace trace.
 *
 * Skips the gateway + LLM call entirely. POSTs a synthetic
 * OTLP/HTTP traces payload directly to the personal project's
 * `/api/otel/v1/traces` endpoint using the project's apiKey. Lands
 * one trace in trace_summaries scoped to the personal projectId
 * within the existing receiver auth + reactor pipeline.
 *
 * Use case: B6.2 modal callsite QA needs at least one clickable
 * trace row in /me/traces; spinning up the gateway + a working
 * LLM credential is heavier than the fixture warrants. This
 * script gives you a row in <2s.
 *
 * Usage (langwatch/ workspace, with `pnpm dev` running):
 *   pnpm tsx scripts/dogfood/governance/seed-personal-trace.ts \
 *     --email rogerio@langwatch.ai \
 *     --org-slug acme \
 *     --base-url http://localhost:5560
 *
 * Optional flags:
 *   --count <n>    How many traces to seed (default 1)
 *   --base-url     LangWatch HTTP base (default http://localhost:5560)
 *
 * Output (JSON on stdout):
 *   { projectId, projectSlug, traceIds: [...] }
 */
import { randomBytes } from "crypto";

import { prisma } from "~/server/db";

interface Args {
  email: string;
  orgSlug: string;
  baseUrl: string;
  count: number;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    baseUrl: "http://localhost:5560",
    count: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i];
    else if (argv[i] === "--org-slug") out.orgSlug = argv[++i];
    else if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--count") out.count = parseInt(argv[++i] ?? "1", 10);
  }
  if (!out.email) throw new Error("--email is required");
  if (!out.orgSlug) throw new Error("--org-slug is required");
  return out as Args;
}

function hexId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function nowNs(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/**
 * Minimal OTLP/HTTP traces payload (proto JSON shape) carrying one
 * span. The receiver translates this into a stored_spans row +
 * trace_summaries fold + reactor pipeline. We don't need a chat
 * payload — a generic instrumented span is enough to show up in
 * the trace explorer.
 */
function buildOtlpTracePayload(traceId: string, spanId: string) {
  const startNs = nowNs();
  const endNs = (BigInt(startNs) + 250_000_000n).toString();
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "personal-trace-fixture" },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "dogfood.seed-personal-trace" },
            spans: [
              {
                traceId,
                spanId,
                name: "fixture.span",
                kind: 1,
                startTimeUnixNano: startNs,
                endTimeUnixNano: endNs,
                attributes: [
                  {
                    key: "fixture.purpose",
                    value: {
                      stringValue: "personal-workspace QA trace row",
                    },
                  },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const user = await prisma.user.findFirst({
    where: { email: args.email },
    select: { id: true },
  });
  if (!user) throw new Error(`No user with email ${args.email}`);

  const org = await prisma.organization.findFirst({
    where: { slug: args.orgSlug },
    select: { id: true },
  });
  if (!org) throw new Error(`No organization with slug ${args.orgSlug}`);

  const team = await prisma.team.findFirst({
    where: {
      organizationId: org.id,
      ownerUserId: user.id,
      isPersonal: true,
      archivedAt: null,
    },
    select: {
      id: true,
      projects: {
        where: { isPersonal: true, archivedAt: null },
        select: { id: true, slug: true, apiKey: true },
        take: 1,
      },
    },
  });
  if (!team || team.projects.length === 0) {
    throw new Error(
      `No personal workspace for ${args.email} in ${args.orgSlug}. ` +
        "Run scripts/dogfood/governance/seed-personas.ts first.",
    );
  }
  const project = team.projects[0]!;

  const traceIds: string[] = [];
  for (let i = 0; i < args.count; i++) {
    const traceId = hexId(16);
    const spanId = hexId(8);
    const payload = buildOtlpTracePayload(traceId, spanId);
    const url = `${args.baseUrl.replace(/\/$/, "")}/api/otel/v1/traces`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${project.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `OTLP push to ${url} failed: ${res.status} ${res.statusText} — ${body.slice(0, 256)}`,
      );
    }
    traceIds.push(traceId);
  }

  process.stdout.write(
    JSON.stringify(
      {
        projectId: project.id,
        projectSlug: project.slug,
        traceIds,
      },
      null,
      0,
    ) + "\n",
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`seed-personal-trace failed: ${err}\n`);
  process.exit(1);
});
