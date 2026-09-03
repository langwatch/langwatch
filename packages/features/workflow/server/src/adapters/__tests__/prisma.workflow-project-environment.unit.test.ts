import { describe, expect, it } from "vitest";
import { PrismaWorkflowProjectEnvironmentAdapter } from "../prisma.workflow-project-environment.adapter";

type ProjectQuery = {
  where: { id: string };
  select: { apiKey: true };
};

type ProjectSecretQuery = {
  where: { projectId: string };
  select: { name: true; encryptedValue: true };
};

function projectEnvironmentAdapter(input: {
  apiKey: string;
  projectSecrets: Array<{ name: string; encryptedValue: string }>;
}) {
  const projectQueries: ProjectQuery[] = [];
  const projectSecretQueries: ProjectSecretQuery[] = [];
  const decryptedValues: string[] = [];

  const port = PrismaWorkflowProjectEnvironmentAdapter.create({
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
    encryption: {
      decrypt(value) {
        decryptedValues.push(value);
        return `decrypted:${value}`;
      },
    },
  });

  return { port, projectQueries, projectSecretQueries, decryptedValues };
}

describe("PrismaWorkflowProjectEnvironmentAdapter", () => {
  it("selects a project's API key and decrypts each project-scoped secret", async () => {
    const adapter = projectEnvironmentAdapter({
      apiKey: "project-api-key",
      projectSecrets: [
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted-openai" },
        { name: "ANTHROPIC_API_KEY", encryptedValue: "encrypted-anthropic" },
      ],
    });

    const environment = await adapter.port.get({ projectId: "project-1" });

    expect(adapter.projectQueries).toEqual([
      { where: { id: "project-1" }, select: { apiKey: true } },
    ]);
    expect(adapter.projectSecretQueries).toEqual([
      {
        where: { projectId: "project-1" },
        select: { name: true, encryptedValue: true },
      },
    ]);
    expect(adapter.decryptedValues).toEqual(["encrypted-openai", "encrypted-anthropic"]);
    expect(environment).toEqual({
      apiKey: "project-api-key",
      secrets: {
        OPENAI_API_KEY: "decrypted:encrypted-openai",
        ANTHROPIC_API_KEY: "decrypted:encrypted-anthropic",
      },
    });
  });

  it("returns an empty secret map without decrypting values", async () => {
    const adapter = projectEnvironmentAdapter({
      apiKey: "project-api-key",
      projectSecrets: [],
    });

    await expect(adapter.port.get({ projectId: "project-1" })).resolves.toEqual({
      apiKey: "project-api-key",
      secrets: {},
    });
    expect(adapter.decryptedValues).toEqual([]);
  });
});
