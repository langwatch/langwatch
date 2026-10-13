import {
  LANGY_VK_SECRET_NAME,
  RESERVED_PROJECT_SECRET_NAMES,
  SecretUnreadableError,
  type GetSecretValuesByNameInput,
  type ListSecretsInput,
  type Secret,
  type SecretApi,
} from "@langwatch/secret-contract";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowProjectEnvironmentService } from "../workflow-project-environment.service.ts";

const projectId = "project-1";
const EPOCH = new Date("2026-10-01T00:00:00.000Z");

/** The secret module as its contract promises: reserved names are never listed or read. */
class ContractSecrets implements Pick<SecretApi, "list" | "getValuesByName"> {
  readonly requested: string[][] = [];

  constructor(
    private readonly stored: Record<string, string>,
    private readonly unreadable: readonly string[] = [],
  ) {}

  async list(input: ListSecretsInput): Promise<Secret[]> {
    return Object.keys(this.stored)
      .filter((name) => !RESERVED_PROJECT_SECRET_NAMES.includes(name))
      .map((name) => ({
        id: `secret-${name}`,
        projectId: input.projectId,
        name,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        createdBy: { name: null },
        updatedBy: { name: null },
      }));
  }

  async getValuesByName(input: GetSecretValuesByNameInput): Promise<Record<string, string>> {
    this.requested.push(input.names);
    const values: Record<string, string> = {};
    for (const name of input.names) {
      const value = this.stored[name];
      if (value === undefined || RESERVED_PROJECT_SECRET_NAMES.includes(name)) continue;
      if (this.unreadable.includes(name)) throw new SecretUnreadableError(name);
      values[name] = value;
    }

    return values;
  }
}

const workflowNaming = (secretName: string, value = `{{ secrets.${secretName} }}`) =>
  parseStudioWorkflow({
    spec_version: "1.5",
    workflow_id: "workflow-1",
    name: "Test Workflow",
    icon: "test",
    description: "test",
    version: "1.0",
    nodes: [
      {
        id: "llm_call",
        type: "signature",
        position: { x: 0, y: 0 },
        data: {
          name: "LLM Call",
          parameters: [{ identifier: "instructions", type: "str", value }],
        },
      },
    ],
    edges: [],
    state: { execution: { status: "idle" } },
  });

describe("WorkflowProjectEnvironmentService", () => {
  describe("given a project holding a reserved secret beside its own", () => {
    /** @scenario "A studio workflow run receives only listed, non-reserved secrets" */
    it("hands the run every listed secret and never reads the reserved one", async () => {
      const secrets = new ContractSecrets({
        OPENAI_API_KEY: "sk-openai",
        HTTP_AGENT_AUTH_TOKEN: "agent-token",
        [LANGY_VK_SECRET_NAME]: "product-owned",
      });

      const environment = await WorkflowProjectEnvironmentService.create({ secrets }).get({
        projectId,
        workflow: workflowNaming(LANGY_VK_SECRET_NAME),
      });

      expect(environment).toEqual({
        secrets: { OPENAI_API_KEY: "sk-openai", HTTP_AGENT_AUTH_TOKEN: "agent-token" },
      });
      expect(secrets.requested.flat()).not.toContain(LANGY_VK_SECRET_NAME);
    });
  });

  describe("given a secret the graph does not name that cannot be read", () => {
    /** @scenario "An unreadable secret the studio workflow does not name leaves the run unaffected" */
    it("leaves that secret out and hands the run the rest", async () => {
      const secrets = new ContractSecrets({ OPENAI_API_KEY: "sk-openai", BROKEN_KEY: "corrupt" }, [
        "BROKEN_KEY",
      ]);

      const environment = await WorkflowProjectEnvironmentService.create({ secrets }).get({
        projectId,
        workflow: workflowNaming("OPENAI_API_KEY"),
      });

      expect(environment).toEqual({ secrets: { OPENAI_API_KEY: "sk-openai" } });
    });
  });

  describe("given a secret the graph names that cannot be read", () => {
    /** @scenario "An unreadable secret the studio workflow names refuses the run" */
    it("refuses with the handled code secret_unreadable", async () => {
      const secrets = new ContractSecrets({ OPENAI_API_KEY: "sk-openai", BROKEN_KEY: "corrupt" }, [
        "BROKEN_KEY",
      ]);

      await expect(
        WorkflowProjectEnvironmentService.create({ secrets }).get({
          projectId,
          workflow: workflowNaming("BROKEN_KEY"),
        }),
      ).rejects.toMatchObject({ code: "secret_unreadable", meta: { name: "BROKEN_KEY" } });
    });
  });

  describe("given code that reads a secret that cannot be read", () => {
    it("refuses with the handled code secret_unreadable", async () => {
      const secrets = new ContractSecrets({ OPENAI_API_KEY: "sk-openai", BROKEN_KEY: "corrupt" }, [
        "BROKEN_KEY",
      ]);

      await expect(
        WorkflowProjectEnvironmentService.create({ secrets }).get({
          projectId,
          workflow: workflowNaming("BROKEN_KEY", "token = secrets.BROKEN_KEY\nprint(token)"),
        }),
      ).rejects.toMatchObject({ code: "secret_unreadable", meta: { name: "BROKEN_KEY" } });
    });
  });

  describe("given a project with no secrets", () => {
    it("hands the run an empty secret map", async () => {
      const environment = await WorkflowProjectEnvironmentService.create({
        secrets: new ContractSecrets({}),
      }).get({ projectId, workflow: workflowNaming("OPENAI_API_KEY") });

      expect(environment).toEqual({ secrets: {} });
    });
  });
});
