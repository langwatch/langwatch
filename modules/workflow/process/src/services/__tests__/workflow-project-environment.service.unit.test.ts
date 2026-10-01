import { describe, expect, it } from "vitest";

import { WorkflowProjectEnvironmentPrismaRepository } from "../../repositories/prisma/prisma.workflow-project-environment.repository.ts";
import { WorkflowProjectEnvironmentService } from "../workflow-project-environment.service.ts";

type ProjectSecretQuery = {
  where: { projectId: string };
  select: { name: true; encryptedValue: true };
};
type StoredSecret = { name: string; encryptedValue: string };

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
  it("decrypts each project-scoped secret", async () => {
    const environmentSeam = projectEnvironment({
      projectSecrets: [
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted-openai" },
        { name: "HTTP_AGENT_AUTH_TOKEN", encryptedValue: "encrypted-agent" },
      ],
    });

    const environment = await environmentSeam.port.get({ projectId: "project-1" });

    expect(environmentSeam.projectSecretQueries).toEqual([
      {
        where: { projectId: "project-1" },
        select: { name: true, encryptedValue: true },
      },
    ]);
    expect(environmentSeam.decryptedValues).toEqual(["encrypted-openai", "encrypted-agent"]);
    expect(environment).toEqual({
      secrets: {
        OPENAI_API_KEY: "decrypted:encrypted-openai",
        HTTP_AGENT_AUTH_TOKEN: "decrypted:encrypted-agent",
      },
    });
  });

  it("returns an empty secret map without decrypting values", async () => {
    const environmentSeam = projectEnvironment({ projectSecrets: [] });

    await expect(environmentSeam.port.get({ projectId: "project-1" })).resolves.toEqual({
      secrets: {},
    });
    expect(environmentSeam.decryptedValues).toEqual([]);
  });
});
