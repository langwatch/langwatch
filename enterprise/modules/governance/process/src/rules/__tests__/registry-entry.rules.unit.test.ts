/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { Agent } from "@langwatch/agent-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  discoveredAgentDraft,
  langwatchAgentDraft,
} from "../../features/registry/rules/registry-entry.rules.ts";
import {
  keepsTrafficInWindow,
  trafficAgentDrafts,
} from "../../features/registry/rules/registry-traffic.rules.ts";

const CREATED = new Date("2026-11-01T10:00:00.000Z");
const BASE = "https://app.langwatch.test";

function record(id: string, name: string) {
  return {
    id,
    projectId: "project-1",
    name,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function draftOf(agent: Agent) {
  return langwatchAgentDraft({ agent, ownerName: null, publicBaseUrl: BASE, consoleUrl: null });
}

describe("langwatchAgentDraft()", () => {
  describe("given a prompt-based agent", () => {
    /** @scenario A prompt-based agent becomes an entry with its model, instructions and callable tool */
    it("names the model, its parameters, the system prompt and an invoke tool", () => {
      const draft = draftOf({
        ...record("agent-1", "Billing assistant"),
        type: "signature",
        config: {
          llm: { model: "openai/gpt-5-mini", temperature: 0.2 },
          messages: [{ role: "system", content: "You answer billing questions." }],
          inputs: [{ identifier: "question", type: "str" }],
        },
      });

      expect(draft.model).toEqual({
        provider: "openai",
        model: "gpt-5-mini",
        parameters: { temperature: 0.2 },
      });
      expect(draft.instructions).toBe("You answer billing questions.");
      expect(draft.tools).toHaveLength(1);
      expect(draft.tools[0]?.name).toBe("invoke");
      expect(draft.tools[0]?.input_schema).toEqual({
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      });
    });
  });

  describe("given a connected agent with a secret parameter", () => {
    /** @scenario A connected agent's declared parameters become its call tool, secrets without defaults */
    it("lists one call tool whose secret property carries no default", () => {
      const draft = draftOf({
        ...record("agent-2", "Field agent"),
        type: "connected",
        config: {
          parameters: [
            { name: "region", type: "string", required: true },
            { name: "token", type: "string", secret: true, defaultValue: "s3cret" },
          ],
          sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        },
      });

      expect(draft.tools.map((tool) => tool.name)).toEqual(["call"]);
      const schema = draft.tools[0]?.input_schema as {
        properties: Record<string, Record<string, unknown>>;
        required: string[];
      };
      expect(Object.keys(schema.properties)).toEqual(["region", "token"]);
      expect(schema.required).toEqual(["region"]);
      expect(schema.properties.token).not.toHaveProperty("default");
      expect(JSON.stringify(draft)).not.toContain("s3cret");
    });
  });

  describe("given an HTTP agent with a bearer token", () => {
    /** @scenario An HTTP agent exposes its URL as an endpoint and never its credentials */
    it("lists the URL as its invoke endpoint and carries no token", () => {
      const draft = draftOf({
        ...record("agent-3", "Remote agent"),
        type: "http",
        config: {
          url: "https://agent.acme.test/run",
          method: "POST",
          auth: { type: "bearer", token: "tok-very-secret" },
          headers: [{ key: "X-Api-Key", value: "hdr-very-secret" }],
        },
      });

      expect(draft.endpoints).toContainEqual({
        kind: "invoke",
        url: "https://agent.acme.test/run",
        protocol: "http",
      });
      expect(JSON.stringify(draft)).not.toContain("tok-very-secret");
      expect(JSON.stringify(draft)).not.toContain("hdr-very-secret");
    });
  });
});

describe("langwatchAgentDraft() with credentials in the URL", () => {
  describe("given an HTTP agent whose URL carries user info, a query and a fragment", () => {
    /** @scenario An HTTP agent's URL is published as its origin and path only */
    it("publishes only the origin and path", () => {
      const draft = draftOf({
        ...record("agent-4", "Keyed agent"),
        type: "http",
        config: {
          url: "https://bot:pw-very-secret@agent.acme.test/run?code=k-very-secret&region=eu#t-very-secret",
          method: "POST",
        },
      });

      expect(draft.endpoints).toContainEqual({
        kind: "invoke",
        url: "https://agent.acme.test/run",
        protocol: "http",
      });
      expect(JSON.stringify(draft)).not.toMatch(/very-secret/);
    });
  });
});

describe("discoveredAgentDraft()", () => {
  describe("given a Copilot Studio agent", () => {
    /** @scenario A Copilot Studio agent a source listed becomes a discovered entry with its environment endpoint */
    it("is a discovered copilot_studio draft with its environment as endpoint", () => {
      const seen = Temporal.Instant.from("2026-11-10T00:00:00Z");
      const draft = discoveredAgentDraft({
        id: "disc-1",
        source: "copilot_studio",
        rawAgentId: "bot-1",
        displayText: "HR helper",
        metadata: { environmentUrl: "https://org.crm.dynamics.com" },
        firstSeenAt: seen,
        lastSeenAt: seen,
      });

      expect(draft.source).toBe("copilot_studio");
      expect(draft.management).toBe("discovered");
      expect(draft.endpoints.map((endpoint) => endpoint.url)).toEqual([
        "https://org.crm.dynamics.com",
      ]);
    });
  });
});

describe("trafficAgentDrafts()", () => {
  const seenAgent = (agentName: string, agentId: string | null = null) => ({
    agentName,
    agentId,
    model: "openai/gpt-5",
    spanCount: 4,
    firstSeenMs: 1_000,
    lastSeenMs: 2_000,
  });

  describe("given an agent only the traces name", () => {
    /** @scenario An agent seen only in traffic is registered as observed and flagged shadow */
    it("builds an observed traffic draft flagged shadow", () => {
      const drafts = trafficAgentDrafts({
        seen: [{ projectId: "project-1", agents: [seenAgent("pricing-bot")] }],
        listed: [],
      });

      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        name: "pricing-bot",
        source: "traffic",
        management: "observed",
        shadow: true,
        model: { provider: "openai", model: "gpt-5" },
      });
    });
  });

  describe("given traced agents a listed source accounts for", () => {
    /** @scenario A traffic agent a listed source accounts for is not listed twice */
    it("builds no traffic draft for a name or id match", () => {
      const listed = draftOf({
        ...record("agent-9", "support bot"),
        type: "signature",
        config: {},
      });

      const drafts = trafficAgentDrafts({
        seen: [
          {
            projectId: "project-1",
            agents: [seenAgent("Support Bot"), seenAgent("router", "agent-9")],
          },
        ],
        listed: [listed],
      });

      expect(drafts).toEqual([]);
    });
  });

  describe("given a traced agent sharing a name with an agent of another project", () => {
    /** @scenario A traced agent named like another project's agent is still flagged shadow */
    it("builds a traffic draft for it", () => {
      const listed = draftOf({ ...record("agent-9", "assistant"), type: "signature", config: {} });

      const drafts = trafficAgentDrafts({
        seen: [{ projectId: "project-2", agents: [seenAgent("Assistant")] }],
        listed: [listed],
      });

      expect(drafts.map((draft) => [draft.name, draft.project_id])).toEqual([
        ["Assistant", "project-2"],
      ]);
    });
  });

  describe("given a traced agent whose id is a provider's agent id", () => {
    /** @scenario A traced agent carrying a listed provider's agent id is not flagged shadow */
    it("builds no traffic draft for it", () => {
      const seen = Temporal.Instant.from("2026-11-10T00:00:00Z");
      const listed = discoveredAgentDraft({
        id: "disc-1",
        source: "databricks",
        rawAgentId: "space-42",
        displayText: "Revenue Analyst",
        metadata: {},
        firstSeenAt: seen,
        lastSeenAt: seen,
      });

      const drafts = trafficAgentDrafts({
        seen: [{ projectId: "project-1", agents: [seenAgent("genie-runner", "space-42")] }],
        listed: [listed],
      });

      expect(drafts).toEqual([]);
    });
  });
});

describe("keepsTrafficInWindow()", () => {
  const SINCE = Date.parse("2026-10-01T00:00:00.000Z");
  const held = ({
    source = "traffic",
    projectId = "project-1",
    name = "planner",
    lastSeenAt = "2026-10-20T00:00:00.000Z",
  }: {
    source?: "langwatch" | "traffic";
    projectId?: string;
    name?: string;
    lastSeenAt?: string | null;
  }) => ({ entry: { source, project_id: projectId, name, last_seen_at: lastSeenAt } });
  const keep = keepsTrafficInWindow({ sinceMs: SINCE, projectIds: ["project-1"], listed: [] });

  describe("given a traced agent last seen inside the window that a read missed", () => {
    /** @scenario A traced agent last seen inside the traffic window stays when a read misses it */
    it("keeps it", () => {
      expect(keep(held({}))).toBe(true);
    });
  });

  describe("given a traced agent last seen before the window", () => {
    /** @scenario A traced agent last seen before the traffic window is removed */
    it("keeps neither it, nor one of a project no longer live, nor a listed source's entry", () => {
      expect(keep(held({ lastSeenAt: "2026-09-01T00:00:00.000Z" }))).toBe(false);
      expect(keep(held({ projectId: "project-gone" }))).toBe(false);
      expect(keep(held({ source: "langwatch" }))).toBe(false);
    });
  });

  describe("given a LangWatch agent of the same name is now defined in its project", () => {
    /** @scenario A traced agent a listed agent now accounts for is removed */
    it("does not keep the traced entry", () => {
      const listed = draftOf({ ...record("agent-9", "Planner"), type: "signature", config: {} });
      const accounted = keepsTrafficInWindow({
        sinceMs: SINCE,
        projectIds: ["project-1"],
        listed: [listed],
      });

      expect(accounted(held({}))).toBe(false);
    });
  });
});
