/** Version listings blank every literal HTTP credential, even in configs that no longer parse. */
import type { AgentVersion, AgentVersions } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { agentVersionsWithoutSecrets } from "../agent-secrets.rules.ts";

function version(input: {
  version: number;
  type: AgentVersion["type"];
  config: object;
}): AgentVersion {
  return {
    id: `agentversion_${input.version}`,
    agentId: "agent_1",
    projectId: "project_1",
    version: input.version,
    name: "Support bot",
    type: input.type,
    config: { ...input.config },
    workflowId: null,
    commitMessage: null,
    authorId: null,
    authorKind: "system",
    author: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    labels: [],
  };
}

function listed(versions: AgentVersion[]): AgentVersions {
  return { versions, labels: [], availableLabels: ["production", "staging"] };
}

describe("agentVersionsWithoutSecrets", () => {
  describe("given an HTTP version whose config parses", () => {
    /** @scenario "A version listing never carries an HTTP credential" */
    it("blanks literal header and auth values and keeps secret references", () => {
      const result = agentVersionsWithoutSecrets(
        listed([
          version({
            version: 1,
            type: "http",
            config: {
              url: "https://agent.example",
              method: "POST",
              headers: [
                { key: "Authorization", value: "Bearer tok_live_123" },
                { key: "X-Api-Key", value: "{{ secrets.AGENT_KEY }}" },
                { key: "Content-Type", value: "application/json" },
              ],
              auth: { type: "bearer", token: "tok_live_456" },
            },
          }),
        ]),
      );

      const config = result.versions[0]?.config;
      expect(config?.headers).toEqual([
        { key: "Authorization", value: "" },
        { key: "X-Api-Key", value: "{{ secrets.AGENT_KEY }}" },
        { key: "Content-Type", value: "application/json" },
      ]);
      expect(config?.auth).toEqual({ type: "bearer", token: "" });
      expect(JSON.stringify(result)).not.toContain("tok_live_");
    });
  });

  describe("given an HTTP version whose config no longer parses", () => {
    /** @scenario "A version listing never carries an HTTP credential" */
    it("serves it without its headers and auth", () => {
      const result = agentVersionsWithoutSecrets(
        listed([
          version({
            version: 2,
            type: "http",
            config: {
              url: 42,
              headers: [{ key: "Authorization", value: "Bearer tok_live_789" }],
              auth: { type: "bearer", token: "tok_live_789" },
            },
          }),
        ]),
      );

      expect(result.versions[0]?.config).toEqual({ url: 42 });
      expect(JSON.stringify(result)).not.toContain("tok_live_");
    });
  });

  describe("given a version that is not HTTP", () => {
    it("serves its config unchanged, with the labels and available labels", () => {
      const input = listed([version({ version: 1, type: "signature", config: { prompt: "hi" } })]);

      const result = agentVersionsWithoutSecrets(input);

      expect(result).toEqual(input);
    });
  });
});
