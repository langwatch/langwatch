/**
 * The checkup over REST, for `langwatch doctor`
 * (sdks/typescript/specs/cli/doctor.feature).
 *
 * The same service the Settings page calls, answered to a project API key
 * the way the `/api/health/*` canaries are. The key names a project, the
 * project names the organization, and the checkup runs for it. The route
 * decides nothing about a check; it authenticates, runs, and prints.
 *
 *   GET  /api/checkup           the free checks and the usage report preview
 *   POST /api/checkup/run       the checks that cost egress or money
 */

import { z } from "zod";
import { env } from "~/env.mjs";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  checkupFor,
  realUsageReportPreview,
} from "~/server/checkup/checkup.deps";
import { CHECK_IDS } from "~/server/checkup/verdict";
import { prisma } from "~/server/db";
import { authenticateProject } from "./health-checks";

const secured = createServiceApp({ basePath: "/api/checkup" });

const AUTH_REASON =
  "Resolves the project API key in the handler the way the health canaries do; the key's project names the organization the checkup runs for.";

const readAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["organization:view"],
  credential: "apiKey",
});

const runAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["organization:manage"],
  credential: "apiKey",
});

const runBody = z.object({
  checks: z.array(z.enum(CHECK_IDS)).optional(),
  scenarioRunPlanId: z.string().min(1).max(200).optional(),
});

async function organizationOf(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team?.organizationId ?? null;
}

secured.access(readAuth).get("/", async (c) => {
  c.header("Cache-Control", "no-store");
  if (env.IS_SAAS) {
    return c.json({ message: "The checkup is for self-hosted installs." }, 404);
  }
  const auth = await authenticateProject(c);
  if ("body" in auth) return c.json(auth.body, { status: auth.status });

  const organizationId = await organizationOf(auth.project.id);
  if (!organizationId) {
    return c.json({ message: "The key's project has no organization." }, 404);
  }

  const [checkup, usageReport] = await Promise.all([
    checkupFor({ prisma, organizationId }).cheap(),
    realUsageReportPreview(prisma),
  ]);
  return c.json({ ...checkup, usageReport });
});

secured.access(runAuth).post("/run", async (c) => {
  c.header("Cache-Control", "no-store");
  if (env.IS_SAAS) {
    return c.json({ message: "The checkup is for self-hosted installs." }, 404);
  }
  const auth = await authenticateProject(c);
  if ("body" in auth) return c.json(auth.body, { status: auth.status });

  const organizationId = await organizationOf(auth.project.id);
  if (!organizationId) {
    return c.json({ message: "The key's project has no organization." }, 404);
  }

  let body: z.infer<typeof runBody> = {};
  const raw = await c.req.text();
  if (raw.trim()) {
    const parsed = runBody.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return c.json({ message: "checks must name checkup rows." }, 400);
    }
    body = parsed.data;
  }

  const result = await checkupFor({ prisma, organizationId }).explicit({
    ...(body.checks ? { checks: body.checks } : {}),
    ...(body.scenarioRunPlanId
      ? { scenarioRunPlanId: body.scenarioRunPlanId }
      : {}),
  });
  return c.json(result);
});

export const app = secured.hono;
