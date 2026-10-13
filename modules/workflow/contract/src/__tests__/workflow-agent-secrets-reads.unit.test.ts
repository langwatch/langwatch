import { describe, expect, it } from "vitest";

import {
  historyEntryWithoutHttpAgentSecrets,
  versionWithoutHttpAgentSecrets,
  workflowWithoutHttpAgentSecrets,
} from "../http-agent-node-secrets.ts";

const dsl = {
  version: "1",
  name: "Triage",
  edges: [],
  nodes: [
    {
      id: "http_agent",
      data: {
        agent: "agents/agent_1",
        parameters: [
          { identifier: "agent_type", type: "str", value: "http" },
          { identifier: "url", type: "str", value: "https://agent.example" },
          { identifier: "auth_type", type: "str", value: "basic" },
          { identifier: "auth_username", type: "str", value: "robot" },
          { identifier: "auth_password", type: "str", value: "password-secret" },
          { identifier: "headers", type: "dict", value: { "x-tenant-key": "tenant-secret" } },
        ],
      },
    },
    {
      id: "inline_http",
      data: {
        parameters: [
          { identifier: "agent_type", type: "str", value: "http" },
          { identifier: "auth_token", type: "str", value: "inline-token" },
        ],
      },
    },
  ],
};

const version = {
  id: "version_1",
  workflowId: "workflow_1",
  projectId: "project_1",
  version: "1",
  autoSaved: false,
  commitMessage: "first",
  authorId: null,
  parentId: null,
  dsl,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const workflow = {
  id: "workflow_1",
  projectId: "project_1",
  name: "Triage",
  icon: null,
  description: null,
  latestVersionId: "version_1",
  currentVersionId: "version_1",
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  currentVersion: version,
  latestVersion: version,
};

describe("workflow reads and saved HTTP agent credentials", () => {
  /** @scenario A workflow read never carries a saved HTTP agent's credentials */
  it("blanks the credentials in a workflow's current and latest versions", () => {
    const answered = workflowWithoutHttpAgentSecrets(workflow);

    for (const answeredVersion of [answered.currentVersion, answered.latestVersion]) {
      expect(JSON.stringify(answeredVersion)).not.toContain("password-secret");
      expect(JSON.stringify(answeredVersion)).not.toContain("tenant-secret");
      expect(answeredVersion?.dsl.nodes[0]).toMatchObject({
        data: {
          parameters: [
            { identifier: "agent_type", value: "http" },
            { identifier: "url", value: "https://agent.example" },
            { identifier: "auth_type", value: "basic" },
            { identifier: "auth_username", value: "robot" },
            { identifier: "auth_password", value: "" },
            { identifier: "headers", value: { "x-tenant-key": "" } },
          ],
        },
      });
    }
  });

  /** @scenario A workflow read never carries a saved HTTP agent's credentials */
  it("blanks the credentials in a restored version and in version history", () => {
    expect(JSON.stringify(versionWithoutHttpAgentSecrets(version))).not.toContain(
      "password-secret",
    );
    expect(
      JSON.stringify(
        historyEntryWithoutHttpAgentSecrets({
          id: "version_1",
          version: "1",
          autoSaved: false,
          commitMessage: "first",
          updatedAt: new Date(0),
          dsl,
          author: null,
        }),
      ),
    ).not.toContain("tenant-secret");
  });

  /** @scenario A token typed into an HTTP node is stored as a project secret and never read back */
  it("keeps a history entry that carries no graph, and answers an inline node's literal blank", () => {
    const metadataOnly = {
      id: "version_1",
      version: "1",
      autoSaved: false,
      commitMessage: "first",
      updatedAt: new Date(0),
      author: null,
    };

    expect(historyEntryWithoutHttpAgentSecrets(metadataOnly)).toBe(metadataOnly);
    expect(versionWithoutHttpAgentSecrets(version).dsl.nodes[1]).toMatchObject({
      data: { parameters: [{}, { identifier: "auth_token", value: "" }] },
    });
  });
});
