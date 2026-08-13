/**
 * Seeds the reported bug's shape: a Studio workflow whose End node declares two
 * results ("output" as text and "chunks" as an object), saved as a workflow
 * agent so it can be added as a target in the experiments workbench.
 *
 * Usage:
 *   PROJECT_SLUG=<slug> npx tsx scripts/dogfood/seed-workflow-agent-with-chunks.ts
 */
import { nanoid } from "nanoid";
import { prisma } from "../../src/server/db";

const CODE = `class Code:
    def __call__(self, question: str):
        return {
            "output": "yes",
            "chunks": {"source": "kb-1", "text": question},
        }
`;

async function main() {
  const slug = process.env.PROJECT_SLUG;
  const project = slug
    ? await prisma.project.findFirst({ where: { slug } })
    : await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("No project found");

  const user = await prisma.user.findUnique({
    where: { email: "dogfood@langwatch.local" },
  });
  if (!user) throw new Error("Seed the dogfood user first");

  const workflowId = `wf_${nanoid(10)}`;
  const dsl = {
    spec_version: "1.4",
    workflow_id: workflowId,
    name: "wf agent",
    icon: "🏁",
    description: "Returns an answer plus the chunks it used",
    version: "1.0",
    template_adapter: "default",
    workflow_type: "workflow",
    enable_tracing: true,
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        deletable: false,
        data: {
          name: "Entry point",
          outputs: [{ identifier: "question", type: "str" }],
          entry_selection: "first",
          train_size: 0.8,
          test_size: 0.2,
          seed: 42,
          dataset: {
            name: "Draft Dataset",
            inline: {
              records: { question: ["is a dog an animal?"] },
              columnTypes: [{ name: "question", type: "string" }],
            },
          },
        },
      },
      {
        id: "retrieve",
        type: "code",
        position: { x: 300, y: 0 },
        data: {
          name: "Retrieve",
          parameters: [{ identifier: "code", type: "code", value: CODE }],
          inputs: [{ identifier: "question", type: "str" }],
          outputs: [
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
          ],
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 30 },
        deletable: false,
        data: {
          name: "End",
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
          ],
        },
      },
    ],
    edges: [
      {
        id: "e0-1",
        source: "entry",
        sourceHandle: "outputs.question",
        target: "retrieve",
        targetHandle: "inputs.question",
        type: "default",
      },
      {
        id: "e1-2",
        source: "retrieve",
        sourceHandle: "outputs.output",
        target: "end",
        targetHandle: "inputs.output",
        type: "default",
      },
      {
        id: "e1-3",
        source: "retrieve",
        sourceHandle: "outputs.chunks",
        target: "end",
        targetHandle: "inputs.chunks",
        type: "default",
      },
    ],
    state: {},
  };

  await prisma.workflow.create({
    data: {
      id: workflowId,
      projectId: project.id,
      name: "wf agent",
      icon: "🏁",
      description: "Returns an answer plus the chunks it used",
    },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      id: `wfv_${nanoid(10)}`,
      workflowId,
      projectId: project.id,
      version: "1",
      commitMessage: "seed",
      authorId: user.id,
      dsl,
    },
  });

  await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      currentVersionId: version.id,
      latestVersionId: version.id,
      publishedId: version.id,
      publishedById: user.id,
    },
  });

  const agent = await prisma.agent.create({
    data: {
      id: `agent_${nanoid(10)}`,
      projectId: project.id,
      name: "wf agent",
      type: "workflow",
      config: { name: "wf agent", isCustom: true, workflow_id: workflowId },
      workflowId,
    },
  });

  console.log(
    JSON.stringify(
      {
        projectSlug: project.slug,
        workflowId,
        agentId: agent.id,
        studioUrl: `/${project.slug}/studio/${workflowId}`,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
