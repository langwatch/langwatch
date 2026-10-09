/**
 * Seeds the scenario half of the shared-session dogfood: four scenarios that
 * ask the code agent one question each, and a suite that runs all four against
 * it.
 *
 * Usage:
 *   PROJECT_SLUG=<slug> AGENT_ID=<id> \
 *     npx tsx scripts/dogfood/seed-agent-cache-scenario.ts
 */
import { nanoid } from "nanoid";
import { prisma } from "../../src/server/db";

const MODEL = "openai/gpt-5-mini";

async function main() {
  const slug = process.env.PROJECT_SLUG;
  if (!slug) throw new Error("PROJECT_SLUG is required");
  const agentId = process.env.AGENT_ID;
  if (!agentId) throw new Error("AGENT_ID is required");
  const count = Number(process.env.SCENARIOS ?? 4);

  const project = await prisma.project.findFirst({
    where: { slug },
    select: { id: true, apiKey: true },
  });
  if (!project) throw new Error(`No project with slug ${slug}`);

  await prisma.scenario.deleteMany({
    where: {
      projectId: project.id,
      name: { startsWith: "shared session ask" },
    },
  });

  const scenarioIds: string[] = [];
  for (let i = 1; i <= count; i++) {
    const scenario = await prisma.scenario.create({
      data: {
        id: `scenario_${nanoid(10)}`,
        projectId: project.id,
        name: `shared session ask ${i}`,
        situation: `Ask the agent exactly this and nothing else: "ping ${i}".`,
        criteria: ["The agent answered with a reply from the ACME API"],
        labels: ["agent-cache-dogfood"],
        simulatorModel: MODEL,
        judgeModel: MODEL,
        maxTurns: 1,
        minTurns: 1,
      },
    });
    scenarioIds.push(scenario.id);
  }

  const suiteName = "shared session dogfood suite";
  await prisma.simulationSuite.deleteMany({
    where: { projectId: project.id, name: suiteName },
  });
  const suite = await prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid(10)}`,
      projectId: project.id,
      name: suiteName,
      slug: `shared-session-dogfood-${nanoid(6)}`.toLowerCase(),
      scenarioIds,
      targets: [{ type: "code", referenceId: agentId }],
      repeatCount: 1,
      labels: [],
    },
  });

  console.log(
    JSON.stringify({ suiteId: suite.id, scenarioIds, agentId }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
