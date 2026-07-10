/**
 * Quick seed: three prompt configs in the "d" project so we can drive an
 * N-way experiment end-to-end without click-through creating 3 prompts.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { slug: "d-1h5icu" },
    include: { team: true },
  });
  if (!project) throw new Error("project d-1h5icu not found");
  const orgId = project.team?.organizationId;
  if (!orgId) throw new Error("could not resolve organizationId");

  const variants = [
    {
      handle: "polite-assistant-v1",
      system:
        "You are a helpful, polite customer support agent. Answer the user's " +
        "question with a clear step-by-step response.",
    },
    {
      handle: "concise-support-v2",
      system:
        "You are a customer support agent. Answer in a single concise " +
        "paragraph — no fluff, just the essentials.",
    },
    {
      handle: "friendly-support-v3",
      system:
        "You are a warm, friendly customer support agent. Answer naturally, " +
        "like you're helping a friend.",
    },
  ];

  for (const v of variants) {
    const existing = await prisma.llmPromptConfig.findFirst({
      where: { projectId: project.id, handle: v.handle },
    });
    if (existing) {
      console.log(`skip ${v.handle} (exists)`);
      continue;
    }
    const prompt = await prisma.llmPromptConfig.create({
      data: {
        projectId: project.id,
        organizationId: orgId,
        handle: v.handle,
        name: v.handle,
      },
    });
    await prisma.llmPromptConfigVersion.create({
      data: {
        configId: prompt.id,
        projectId: project.id,
        version: 1,
        commitMessage: "seed",
        schemaVersion: "1.0",
        configData: {
          prompt: v.system,
          messages: [{ role: "user", content: "{{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          model: "openai/gpt-5-mini",
        },
      },
    });
    console.log(`created ${v.handle}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
