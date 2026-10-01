import type { SecretApi } from "@langwatch/secret-contract";
import {
  parseStudioWorkflow,
  workflowWithoutHttpAgentSecrets,
  type StudioWorkflow,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowHttpSecretsService } from "../workflow-http-secrets.service.ts";

const TOKEN = "tok_live_partner_123";

const secretRow = (name: string) => ({
  id: name,
  projectId: "project-1",
  name,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  createdBy: { name: null },
  updatedBy: { name: null },
});

function build() {
  const values: Record<string, string> = {};
  const writers: (string | undefined)[] = [];
  const secrets: Pick<SecretApi, "getValues" | "create"> = {
    getValues: async () => ({ ...values }),
    create: async (input, by) => {
      values[input.name] = input.value;
      writers.push(by?.id);

      return secretRow(input.name);
    },
  };

  return { service: WorkflowHttpSecretsService.create(secrets), values, writers };
}

function graphWithHttpNode(token: string): StudioWorkflow {
  return parseStudioWorkflow({
    workflow_id: "wf-1",
    spec_version: "1.4",
    name: "Partner flow",
    icon: "x",
    description: "x",
    version: "1.0",
    nodes: [
      {
        id: "call",
        type: "http",
        position: { x: 0, y: 0 },
        data: {
          name: "Partner API",
          parameters: [
            { identifier: "url", type: "str", value: "https://partner.example" },
            { identifier: "auth_type", type: "str", value: "bearer" },
            { identifier: "auth_token", type: "str", value: token },
          ],
        },
      },
    ],
    edges: [],
    state: {},
  });
}

const store = (service: WorkflowHttpSecretsService, token: string) =>
  service.store({ projectId: "project-1", dsl: graphWithHttpNode(token), authorId: "user-1" });

function readOf(dsl: StudioWorkflow): WorkflowWithVersion {
  const at = new Date(0);

  return {
    id: "wf-1",
    projectId: "project-1",
    name: "Partner flow",
    icon: null,
    description: null,
    latestVersionId: "version-1",
    currentVersionId: "version-1",
    publishedId: null,
    publishedById: null,
    copiedFromWorkflowId: null,
    isEvaluator: false,
    isComponent: false,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    currentVersion: {
      id: "version-1",
      workflowId: "wf-1",
      projectId: "project-1",
      version: "1",
      autoSaved: true,
      commitMessage: "autosave",
      authorId: "user-1",
      parentId: null,
      dsl,
      createdAt: at,
      updatedAt: at,
    },
  };
}

describe("a token typed into an HTTP node of a graph being saved", () => {
  /** @scenario A token typed into an HTTP node is stored as a project secret and never read back */
  it("becomes a project secret, attributed to the author, and the node keeps its reference", async () => {
    const { service, values, writers } = build();

    const stored = await store(service, TOKEN);

    expect(values).toEqual({ HTTP_PARTNER_API_AUTH_TOKEN: TOKEN });
    expect(writers).toEqual(["user-1"]);
    expect(JSON.stringify(stored)).toContain("{{ secrets.HTTP_PARTNER_API_AUTH_TOKEN }}");
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
  });

  /** @scenario A token typed into an HTTP node is stored as a project secret and never read back */
  it("is in no read of the graph, which keeps the reference a form shows by name", async () => {
    const { service } = build();

    const read = workflowWithoutHttpAgentSecrets(readOf(await store(service, TOKEN)));

    expect(JSON.stringify(read)).not.toContain(TOKEN);
    expect(JSON.stringify(read)).toContain("{{ secrets.HTTP_PARTNER_API_AUTH_TOKEN }}");
  });

  it("is stored once however often the same graph is saved", async () => {
    const { service, values } = build();

    await store(service, TOKEN);
    await store(service, TOKEN);

    expect(Object.keys(values)).toEqual(["HTTP_PARTNER_API_AUTH_TOKEN"]);
  });

  it("keeps an earlier token when a different one is typed into a node of the same name", async () => {
    const { service, values } = build();

    await store(service, TOKEN);
    await store(service, "tok_live_other_456");

    expect(values).toEqual({
      HTTP_PARTNER_API_AUTH_TOKEN: TOKEN,
      HTTP_PARTNER_API_AUTH_TOKEN_2: "tok_live_other_456",
    });
  });
});
