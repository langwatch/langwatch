import { prisma } from "../src/server/db";

async function main() {
  const apiKey = process.env.LANGWATCH_API_KEY;
  const project = await prisma.project.findFirst({ where: { apiKey } });
  if (!project) throw new Error("project not found");

  const azureMp = await prisma.modelProvider.findFirst({
    where: { projectId: project.id, provider: "azure" },
  });
  if (!azureMp) throw new Error("azure ModelProvider not found");

  await prisma.modelProvider.update({
    where: { id: azureMp.id },
    data: {
      deploymentMapping: { "gpt-5-mini": "gpt-5-mini" } as any,
    },
  });
  console.log(
    `✓ updated azure (${azureMp.id}) deploymentMapping: gpt-5-mini→gpt-5-mini`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
