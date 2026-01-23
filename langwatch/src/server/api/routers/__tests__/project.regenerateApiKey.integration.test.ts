/**
 * @vitest-environment node
 *
 * Integration tests for project.regenerateApiKey mutation.
 * Tests the actual mutation behavior with a real test database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("project.regenerateApiKey integration", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  it("regenerates API key for existing project", async () => {
    // Get the original API key
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true },
    });

    if (!project) {
      throw new Error("Test project not found");
    }

    const originalApiKey = project.apiKey;

    // Regenerate the API key
    const result = await caller.project.regenerateApiKey({ projectId });

    // Verify the new key is different
    expect(result.apiKey).not.toBe(originalApiKey);
    expect(result.apiKey).toMatch(/^sk-lw-/);

    // Verify the key was actually updated in the database
    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true },
    });
    expect(updatedProject?.apiKey).toBe(result.apiKey);
    expect(updatedProject?.apiKey).not.toBe(originalApiKey);
  });

  it("returns NOT_FOUND for nonexistent project", async () => {
    await expect(
      caller.project.regenerateApiKey({ projectId: "nonexistent-project-id" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  });
});
