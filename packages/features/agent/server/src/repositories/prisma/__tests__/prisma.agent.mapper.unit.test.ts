/**
 * @vitest-environment node
 * @see packages/features/agent/specs/package-boundary.feature
 */
import { describe, expect, it } from "vitest";
import { mapAgentRow, type AgentRow } from "../prisma.agent.mapper.ts";

function persistedRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent_1",
    projectId: "project_1",
    name: "Answerer",
    type: "signature",
    config: {
      prompt: "Answer clearly",
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
    },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("given a persisted agent row", () => {
  describe("when the Agents repository maps it", () => {
    /** @scenario "Persisted rows are mapped into contract agents" */
    it("validates the config against the contract schema and answers a contract agent", () => {
      const agent = mapAgentRow(persistedRow());

      expect(agent).toMatchObject({
        id: "agent_1",
        projectId: "project_1",
        type: "signature",
        config: { prompt: "Answer clearly" },
      });

      expect(() => mapAgentRow(persistedRow({ config: { prompt: 42 } }))).toThrowError();
      expect(() => mapAgentRow(persistedRow({ type: "not-an-agent-type" }))).toThrowError();
    });

    it("settles every connected-agent column a non-connected row never carries", () => {
      const agent = mapAgentRow(persistedRow());

      expect(agent).toMatchObject({
        environment: null,
        ownerUserId: null,
        hostLabel: null,
        identityKey: null,
        lastSeenAt: null,
      });
      expect(agent).not.toHaveProperty("_count");
      expect(agent).not.toHaveProperty("copyCount");
    });

    it("reports the copy count only when the query asked for it", () => {
      const counted = mapAgentRow(persistedRow({ _count: { copiedAgents: 3 } }));

      expect(counted).toMatchObject({ copyCount: 3 });
    });
  });
});
