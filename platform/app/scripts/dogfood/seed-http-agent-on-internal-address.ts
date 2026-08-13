/**
 * Seeds the reported bug's shape: an HTTP agent pointing at a service on the
 * local network, with a body template written the way the engine reads it
 * (spaces inside the braces).
 *
 * Before this change the test button reached it and the evaluation did not,
 * and the browser substituted "{{threadId}}" but not "{{ threadId }}".
 *
 * Usage:
 *   PROJECT_SLUG=<slug> AGENT_URL=http://127.0.0.1:7788/chat \
 *     npx tsx scripts/dogfood/seed-http-agent-on-internal-address.ts
 */
import { nanoid } from "nanoid";
import { prisma } from "../../src/server/db";

async function main() {
  const slug = process.env.PROJECT_SLUG;
  if (!slug) throw new Error("PROJECT_SLUG is required");

  const url = process.env.AGENT_URL;
  if (!url) throw new Error("AGENT_URL is required");

  const project = await prisma.project.findFirst({ where: { slug } });
  if (!project) throw new Error(`No project with slug ${slug}`);

  const agent = await prisma.agent.create({
    data: {
      id: `agent_${nanoid(10)}`,
      projectId: project.id,
      name: "internal http agent",
      type: "http",
      config: {
        name: "internal http agent",
        isCustom: true,
        url,
        method: "POST",
        bodyTemplate: '{"thread": "{{ threadId }}", "messages": {{ messages }}}',
        outputPath: "$.answer",
      },
    },
  });

  console.log(
    JSON.stringify(
      { projectSlug: project.slug, agentId: agent.id, url },
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
