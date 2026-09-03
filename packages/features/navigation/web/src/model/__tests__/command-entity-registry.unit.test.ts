/**
 * @vitest-environment node
 *
 * Unit tests for entity registry scenario prefix support.
 * @see specs/features/scenarios/scenario-id-format.feature
 * Scenario: Command bar entity registry recognizes both prefixes
 */

import { describe, expect, it } from "vitest";
import {
  agentEditorDrawerForType,
  agentPath,
  entityRegistry,
  findEntityByPrefix,
} from "../command-entity-registry";

describe("entityRegistry", () => {
  describe("when looking up scenario prefixes", () => {
    /** @scenario Command bar entity registry recognizes both prefixes */
    it("has an entry for the 'scenario_' prefix", () => {
      const entry = entityRegistry.find((e) => e.prefix === "scenario_");
      expect(entry).toBeDefined();
      expect(entry?.label).toBe("Scenario");
    });

    it("has an entry for the legacy 'scen_' prefix", () => {
      const entry = entityRegistry.find((e) => e.prefix === "scen_");
      expect(entry).toBeDefined();
      expect(entry?.label).toBe("Scenario");
    });

    it("recognizes a scenario_ ID via findEntityByPrefix()", () => {
      const result = findEntityByPrefix("scenario_abc123");
      expect(result).toBeDefined();
      expect(result?.prefix).toBe("scenario_");
    });

    it("recognizes a legacy scen_ ID via findEntityByPrefix()", () => {
      const result = findEntityByPrefix("scen_abc123");
      expect(result).toBeDefined();
      expect(result?.prefix).toBe("scen_");
    });
  });
});

/**
 * @see specs/navigation/command-bar-agent-address.feature
 *
 * The palette used to write `?drawer.open=agentViewer` for every agent it
 * found — a drawer name that has never been in any registry and has never had
 * a component. The reader pressed enter, the address bar changed, and nothing
 * opened. These pin the three real editors and the two cases that have none.
 */
describe("given an agent found in the command bar", () => {
  describe("when its kind has an editor", () => {
    /** @scenario "A code agent found by name opens the code editor" */
    it("addresses the code editor for a code agent", () => {
      expect(agentPath({ projectSlug: "acme", agentId: "agent_1", type: "code" })).toBe(
        "/acme/agents?drawer.open=agentCodeEditor&drawer.agentId=agent_1",
      );
    });

    /** @scenario "An HTTP agent found by name opens the HTTP editor" */
    it("addresses the HTTP editor for an http agent", () => {
      expect(agentPath({ projectSlug: "acme", agentId: "agent_2", type: "http" })).toBe(
        "/acme/agents?drawer.open=agentHttpEditor&drawer.agentId=agent_2",
      );
    });

    /** @scenario "A workflow agent found by name opens the workflow editor" */
    it("addresses the workflow editor for a workflow agent", () => {
      expect(agentPath({ projectSlug: "acme", agentId: "agent_3", type: "workflow" })).toBe(
        "/acme/agents?drawer.open=agentWorkflowEditor&drawer.agentId=agent_3",
      );
    });
  });

  describe("when nothing can hold it open", () => {
    /** @scenario "An agent with no editor lands on the agents list" */
    it("sends a signature agent to the agents list", () => {
      expect(agentEditorDrawerForType("signature")).toBeNull();
      expect(agentPath({ projectSlug: "acme", agentId: "agent_4", type: "signature" })).toBe(
        "/acme/agents",
      );
    });

    /** @scenario "A pasted agent id lands on the agents list" */
    it("sends a pasted id to the agents list, since an id carries no kind", () => {
      const entry = entityRegistry.find((candidate) => candidate.prefix === "agent_");
      expect(entry?.pathBuilder("agent_5", "acme")).toBe("/acme/agents");
    });
  });

  /** @scenario "No agent address names the phantom drawer" */
  it("never writes the drawer name that opened nothing", () => {
    const addresses = (["code", "http", "workflow", "signature"] as const).map((type) =>
      agentPath({ projectSlug: "acme", agentId: "agent_6", type }),
    );

    for (const address of addresses) expect(address).not.toContain("agentViewer");
  });
});
