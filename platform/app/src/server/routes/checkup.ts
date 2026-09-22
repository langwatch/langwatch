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

import { describeRoute } from "hono-openapi";
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

const CHECKUP_TAG = ["Checkup"];

const rowSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "The check, one of the ids `POST /api/checkup/run` accepts.",
    },
    name: { type: "string" },
    group: {
      type: "string",
      enum: ["install", "langwatch", "integrations", "pipelines"],
    },
    cost: {
      type: "string",
      enum: ["free", "egress", "paid"],
      description:
        "Free checks run on every call; egress and paid ones only through `POST /api/checkup/run`.",
    },
    verdict: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["verified", "refused", "unchecked"] },
        detail: { type: "string" },
        code: {
          type: "string",
          description: "Present on a refused verdict: the stable error code.",
        },
        fix: { type: "string" },
        docsPath: { type: "string" },
      },
      required: ["outcome", "detail"],
    },
  },
  required: ["id", "name", "group", "cost", "verdict"],
};

const reportSchema = {
  type: "object",
  properties: {
    ranAt: { type: "string", format: "date-time" },
    rows: { type: "array", items: rowSchema },
  },
  required: ["ranAt", "rows"],
};

secured.access(readAuth).get(
  "/",
  describeRoute({
    summary: "Run the free checks of a self-hosted install",
    description:
      "The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass, fail or not checked verdict. Checks that open a connection or spend money are reported as not checked here and run through `POST /api/checkup/run`. The response also carries the usage report this install would send next. Answers 404 on LangWatch Cloud.",
    tags: CHECKUP_TAG,
    responses: {
      200: {
        description: "The checkup report and the usage report preview.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ...reportSchema.properties,
                usageReport: { type: "object", additionalProperties: true },
              },
              required: ["ranAt", "rows", "usageReport"],
            },
          },
        },
      },
      404: {
        description:
          "The install is LangWatch Cloud, or the key's project has no organization.",
      },
    },
  }),
  async (c) => {
    c.header("Cache-Control", "no-store");
    if (env.IS_SAAS) {
      return c.json(
        { message: "The checkup is for self-hosted installs." },
        404,
      );
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
  },
);

secured.access(runAuth).post(
  "/run",
  describeRoute({
    summary: "Run the checks that open a connection or spend money",
    description:
      "Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts, the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the checks to run, or leave the list out to run them all. The scenario canary launches a real run and needs a run plan id. Answers 404 on LangWatch Cloud.",
    tags: CHECKUP_TAG,
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              checks: {
                type: "array",
                items: { type: "string" },
                description:
                  "The check ids to run. Omit to run every explicit check.",
              },
              scenarioRunPlanId: {
                type: "string",
                description: "The run plan the scenario canary launches.",
              },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "The rows of the checks that ran.",
        content: { "application/json": { schema: reportSchema } },
      },
      404: {
        description:
          "The install is LangWatch Cloud, or the key's project has no organization.",
      },
    },
  }),
  async (c) => {
    c.header("Cache-Control", "no-store");
    if (env.IS_SAAS) {
      return c.json(
        { message: "The checkup is for self-hosted installs." },
        404,
      );
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
  },
);

export const app = secured.hono;
