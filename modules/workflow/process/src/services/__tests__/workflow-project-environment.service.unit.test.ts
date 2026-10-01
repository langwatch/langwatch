import { describe, expect, it } from "vitest";

import { WorkflowProjectEnvironmentPrismaRepository } from "../../repositories/prisma/prisma.workflow-project-environment.repository.ts";
import { WorkflowProjectEnvironmentService } from "../workflow-project-environment.service.ts";

type ProjectSecretQuery = {
  where: { projectId: string };
  select: { name: true; encryptedValue: true; boundOrigin: true };
};
type StoredSecret = { name: string; encryptedValue: string; boundOrigin: string | null };

function projectEnvironment(input: { projectSecrets: StoredSecret[] }) {
  const projectSecretQueries: ProjectSecretQuery[] = [];
  const decryptedValues: string[] = [];

  const port = WorkflowProjectEnvironmentService.create({
    repository: WorkflowProjectEnvironmentPrismaRepository.create({
      database: {
        projectSecret: {
          async findMany(query: ProjectSecretQuery) {
            projectSecretQueries.push(query);
            return input.projectSecrets;
          },
        },
      },
    }),
    encryption: {
      decrypt(value) {
        decryptedValues.push(value);
        return `decrypted:${value}`;
      },
    },
  });

  return { port, projectSecretQueries, decryptedValues };
}

describe("WorkflowProjectEnvironmentService over the Prisma repository", () => {
  /** @scenario "A workflow run sends a saved credential only to the address it was saved for" */
  it("decrypts each project-scoped secret and names the origin each bound one may reach", async () => {
    const environmentSeam = projectEnvironment({
      projectSecrets: [
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted-openai", boundOrigin: null },
        {
          name: "HTTP_AGENT_AUTH_TOKEN",
          encryptedValue: "encrypted-agent",
          boundOrigin: "https://agent.example.com",
        },
      ],
    });

    const environment = await environmentSeam.port.get({ projectId: "project-1" });

    expect(environmentSeam.projectSecretQueries).toEqual([
      {
        where: { projectId: "project-1" },
        select: { name: true, encryptedValue: true, boundOrigin: true },
      },
    ]);
    expect(environmentSeam.decryptedValues).toEqual(["encrypted-openai", "encrypted-agent"]);
    expect(environment).toEqual({
      secrets: {
        OPENAI_API_KEY: "decrypted:encrypted-openai",
        HTTP_AGENT_AUTH_TOKEN: "decrypted:encrypted-agent",
      },
      secretOrigins: { HTTP_AGENT_AUTH_TOKEN: "https://agent.example.com" },
    });
  });

  it("returns an empty secret map without decrypting values", async () => {
    const environmentSeam = projectEnvironment({ projectSecrets: [] });

    await expect(environmentSeam.port.get({ projectId: "project-1" })).resolves.toEqual({
      secrets: {},
      secretOrigins: {},
    });
    expect(environmentSeam.decryptedValues).toEqual([]);
  });
});
