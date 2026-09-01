/**
 * Seeds the shared-session dogfood: the committed example as a code agent,
 * the project secrets it reads, and an experiment whose saved workbench state
 * runs it over an inline dataset.
 *
 * Usage:
 *   PROJECT_SLUG=<slug> ACME_BASE=http://127.0.0.1:5599 \
 *     npx tsx scripts/dogfood/seed-agent-cache-shared-session.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { ExperimentType } from "~/generated/prisma/client";
import { prisma } from "../../src/server/db";
import { encrypt } from "../../src/utils/encryption";

const EXAMPLE = path.join(
  __dirname,
  "../../../../services/nlpgo/app/engine/blocks/codeblock/examples/shared_session_code_agent.py",
);

async function upsertSecret({
  projectId,
  userId,
  name,
  value,
}: {
  projectId: string;
  userId: string;
  name: string;
  value: string;
}) {
  const existing = await prisma.projectSecret.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  const encryptedValue = encrypt(value);
  if (existing) {
    await prisma.projectSecret.update({
      where: { id: existing.id, projectId },
      data: { encryptedValue, updatedById: userId },
    });
    return;
  }
  await prisma.projectSecret.create({
    data: {
      projectId,
      name,
      encryptedValue,
      createdById: userId,
      updatedById: userId,
    },
  });
}

async function main() {
  const slug = process.env.PROJECT_SLUG;
  if (!slug) throw new Error("PROJECT_SLUG is required");
  const acmeBase = process.env.ACME_BASE ?? "http://127.0.0.1:5599";
  const rows = Number(process.env.ROWS ?? 4);

  const project = await prisma.project.findFirst({
    where: { slug },
    select: { id: true, slug: true, apiKey: true, teamId: true },
  });
  if (!project) throw new Error(`No project with slug ${slug}`);

  const team = await prisma.team.findUnique({
    where: { id: project.teamId },
    select: { organizationId: true },
  });
  const owner = await prisma.organizationUser.findFirst({
    where: { organizationId: team!.organizationId },
    select: { userId: true },
  });
  const userId = owner!.userId;

  for (const [name, value] of Object.entries({
    ACME_LOGIN_URL: `${acmeBase}/login`,
    ACME_API_URL: `${acmeBase}/chat`,
    ACME_USERNAME: "acme-robot",
    ACME_PASSWORD: "p4ssw0rd-dogfood",
  })) {
    await upsertSecret({ projectId: project.id, userId, name, value });
  }

  // SHORT_TTL rewrites the example's two constants so a stored session lapses
  // inside a dogfood run instead of a quarter of an hour later. Nothing else
  // about the example changes.
  const code = process.env.SHORT_TTL
    ? readFileSync(EXAMPLE, "utf8")
        .replace("SESSION_TTL_SECONDS = 15 * 60", "SESSION_TTL_SECONDS = 15")
        .replace("REFRESH_MARGIN_SECONDS = 60", "REFRESH_MARGIN_SECONDS = 10")
    : readFileSync(EXAMPLE, "utf8");
  const agentName = "shared session dogfood";
  const existingAgent = await prisma.agent.findFirst({
    where: { projectId: project.id, name: agentName },
    select: { id: true },
  });
  const config = {
    name: agentName,
    isCustom: true,
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs: [{ identifier: "message", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    scenarioMappings: {
      message: { type: "source", sourceId: "scenario", path: ["input"] },
    },
    scenarioOutputField: "output",
  };
  const agent = existingAgent
    ? await prisma.agent.update({
        where: { id: existingAgent.id, projectId: project.id },
        data: { config },
      })
    : await prisma.agent.create({
        data: {
          id: `agent_${nanoid(10)}`,
          projectId: project.id,
          name: agentName,
          type: "code",
          config,
        },
      });

  const datasetId = "ds-shared-session";
  const targetId = "target-shared-session";
  const workbenchState = {
    name: "Shared session dogfood",
    datasets: [
      {
        id: datasetId,
        name: "messages",
        type: "inline",
        columns: [{ id: "message", name: "message", type: "string" }],
        inline: {
          columns: [{ id: "message", name: "message", type: "string" }],
          records: {
            message: Array.from({ length: rows }, (_, i) => `ping ${i + 1}`),
          },
        },
      },
    ],
    activeDatasetId: datasetId,
    evaluators: [],
    targets: [
      {
        id: targetId,
        type: "agent",
        dbAgentId: agent.id,
        agentType: "code",
        mappings: {
          [datasetId]: {
            message: {
              type: "source",
              source: "dataset",
              sourceId: datasetId,
              sourceField: "message",
            },
          },
        },
      },
    ],
    concurrency: Number(process.env.CONCURRENCY ?? 1),
  };

  const experimentSlug = "shared-session-dogfood";
  const experiment = await prisma.experiment.upsert({
    where: {
      projectId_slug: { projectId: project.id, slug: experimentSlug },
    },
    create: {
      id: `experiment_${nanoid(10)}`,
      projectId: project.id,
      slug: experimentSlug,
      name: "Shared session dogfood",
      type: ExperimentType.EVALUATIONS_V3,
      workbenchState,
    },
    update: { workbenchState },
  });

  console.log(
    JSON.stringify(
      {
        projectId: project.id,
        projectSlug: project.slug,
        projectApiKey: project.apiKey,
        agentId: agent.id,
        experimentSlug: experiment.slug,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
