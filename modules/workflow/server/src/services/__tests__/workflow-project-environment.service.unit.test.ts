import { describe, expect, it } from "vitest";
import { WorkflowProjectEnvironmentPrismaRepository } from "../../repositories/prisma/prisma.workflow-project-environment.repository.ts";
import { WorkflowProjectEnvironmentService } from "../workflow-project-environment.service.ts";

type ProjectQuery = {
  where: { id: string };
  select: { apiKey: true };
};

type ProjectSecretQuery = {
  where: { projectId: string };
  select: { name: true; encryptedValue: true };
};

function projectEnvironment(input: {
  apiKey: string;
  projectSecrets: Array<{ name: string; encryptedValue: string }>;
}) {
  const projectQueries: ProjectQuery[] = [];
  const projectSecretQueries: ProjectSecretQuery[] = [];
  const decryptedValues: string[] = [];

  const port = WorkflowProjectEnvironmentService.create({
    repository: WorkflowProjectEnvironmentPrismaRepository.create({
      database: {
        project: {
          async findUniqueOrThrow(query: ProjectQuery) {
            projectQueries.push(query);
            return { apiKey: input.apiKey };
          },
        },
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

  return { port, projectQueries, projectSecretQueries, decryptedValues };
}

describe("WorkflowProjectEnvironmentService over the Prisma repository", () => {
  it("selects a project's API key and decrypts each project-scoped secret", async () => {
    const environmentSeam = projectEnvironment({
      apiKey: "project-api-key",
      projectSecrets: [
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted-openai" },
        { name: "ANTHROPIC_API_KEY", encryptedValue: "encrypted-anthropic" },
      ],
    });

    const environment = await environmentSeam.port.get({ projectId: "project-1" });

    expect(environmentSeam.projectQueries).toEqual([
      { where: { id: "project-1" }, select: { apiKey: true } },
    ]);
    expect(environmentSeam.projectSecretQueries).toEqual([
      {
        where: { projectId: "project-1" },
        select: { name: true, encryptedValue: true },
      },
    ]);
    expect(environmentSeam.decryptedValues).toEqual(["encrypted-openai", "encrypted-anthropic"]);
    expect(environment).toEqual({
      apiKey: "project-api-key",
      secrets: {
        OPENAI_API_KEY: "decrypted:encrypted-openai",
        ANTHROPIC_API_KEY: "decrypted:encrypted-anthropic",
      },
    });
  });

  it("returns an empty secret map without decrypting values", async () => {
    const environmentSeam = projectEnvironment({
      apiKey: "project-api-key",
      projectSecrets: [],
    });

    await expect(environmentSeam.port.get({ projectId: "project-1" })).resolves.toEqual({
      apiKey: "project-api-key",
      secrets: {},
    });
    expect(environmentSeam.decryptedValues).toEqual([]);
  });
});
