/**
 * QA fixture for the guardrail enforcement fix.
 *
 * Creates an org, team, project, evaluator, AS_GUARDRAIL monitor and two
 * gateway guardrails, one fail-closed and one fail-open, plus a virtual key
 * for each. Used to prove end to end that a guardrail which cannot be
 * evaluated now stops a fail-closed request instead of quietly allowing it.
 *
 * Run with: pnpm tsx .claude/qa-seed-guardrail.ts
 */
import { nanoid } from "nanoid";

import { prisma } from "../src/server/db";

const suffix = nanoid(6).toLowerCase();

async function main() {
  const org = await prisma.organization.create({
    data: { name: `ACME QA ${suffix}`, slug: `acme-qa-${suffix}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `ACME QA Team ${suffix}`,
      slug: `acme-qa-team-${suffix}`,
      organizationId: org.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `ACME QA Project ${suffix}`,
      slug: `acme-qa-proj-${suffix}`,
      teamId: team.id,
      language: "other",
      framework: "other",
      apiKey: `qa-key-${suffix}`,
    },
  });

  const evaluator = await prisma.evaluator.create({
    data: {
      projectId: project.id,
      name: `QA PII detector ${suffix}`,
      type: "evaluator",
      config: {},
    },
  });
  await prisma.monitor.create({
    data: {
      projectId: project.id,
      evaluatorId: evaluator.id,
      checkType: "langevals/basic",
      name: `QA guardrail monitor ${suffix}`,
      slug: `qa-guardrail-monitor-${suffix}`,
      executionMode: "AS_GUARDRAIL",
      enabled: true,
      preconditions: [],
      parameters: {},
    },
  });

  const failClosed = await prisma.gatewayGuardrail.create({
    data: {
      projectId: project.id,
      name: `QA fail-closed ${suffix}`,
      evaluatorId: evaluator.id,
      direction: "PRE",
      failureMode: "FAIL_CLOSED",
    },
  });
  const failOpen = await prisma.gatewayGuardrail.create({
    data: {
      projectId: project.id,
      name: `QA fail-open ${suffix}`,
      evaluatorId: evaluator.id,
      direction: "PRE",
      failureMode: "FAIL_OPEN",
    },
  });

  console.log(
    JSON.stringify(
      {
        organizationId: org.id,
        teamId: team.id,
        projectId: project.id,
        evaluatorId: evaluator.id,
        failClosedGuardrailId: failClosed.id,
        failOpenGuardrailId: failOpen.id,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
