/**
 * What `openAgentEditor` writes — the Agents host's one composed value.
 * Spec: specs/agents/agent-management.feature
 */

import { describe, expect, it, vi } from "vitest";
import { DRAWER_OPEN_PARAM } from "../src/model/ui-drawer-address";
import {
  DRAWER_AGENT_ID_PARAM,
  openAgentEditor,
} from "../src/features/agent/behavior/agent-editor";

describe("given openAgentEditor", () => {
  describe("when the screen opens an editor for one agent", () => {
    it("writes the address the rest of the product produces for it", () => {
      const setQuery = vi.fn();

      openAgentEditor({ query: {}, drawer: "agentHttpEditor", agentId: "agent_1", setQuery });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "agentHttpEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_1",
      });
    });

    it("keeps the query the reader already had", () => {
      const setQuery = vi.fn();

      openAgentEditor({
        query: { history: "agent_9", tab: "all" },
        drawer: "agentCodeEditor",
        agentId: "agent_2",
        setQuery,
      });

      expect(setQuery).toHaveBeenCalledWith({
        history: "agent_9",
        tab: "all",
        [DRAWER_OPEN_PARAM]: "agentCodeEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_2",
      });
    });

    /** @scenario "A stale editor address is cleared before a new one is written" */
    it("drops a previous drawer's parameters rather than opening on its agent", () => {
      const setQuery = vi.fn();

      openAgentEditor({
        query: {
          [DRAWER_OPEN_PARAM]: "agentWorkflowEditor",
          [DRAWER_AGENT_ID_PARAM]: "agent_before",
          "drawer.workflowId": "wf_1",
          tab: "all",
        },
        drawer: "agentHttpEditor",
        agentId: "agent_after",
        setQuery,
      });

      expect(setQuery).toHaveBeenCalledWith({
        tab: "all",
        [DRAWER_OPEN_PARAM]: "agentHttpEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_after",
      });
    });
  });

  describe("when the screen opens an editor for an agent that does not exist yet", () => {
    it("names the drawer and no agent", () => {
      const setQuery = vi.fn();

      openAgentEditor({ query: {}, drawer: "agentCodeEditor", setQuery });

      expect(setQuery).toHaveBeenCalledWith({ [DRAWER_OPEN_PARAM]: "agentCodeEditor" });
    });
  });
});
