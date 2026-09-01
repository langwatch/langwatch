/**
 * What the Agents host answers, and — the part worth a test — what it writes.
 *
 * Most of the port is a value object over readings the provider already made, so
 * the assertions below concentrate on the one method that composes something:
 * `openAgentEditor`, which is this family's single piece of platform vocabulary.
 * The code, HTTP and workflow editors are still `platform/app`'s registered
 * drawers, so the screen names one and this adapter writes the address the rest
 * of the product already produces for an agent.
 *
 * Getting that address wrong is silent in both directions: a missing
 * `drawer.agentId` opens an empty editor, and a LEFTOVER one from a previous
 * drawer opens the editor on the agent the reader looked at before this one.
 * `openDrawer` clears every `drawer.*` key for exactly that reason, and this
 * adapter has to as well.
 *
 * Spec: specs/agents/agent-management.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentBrowserPort } from "@langwatch/agent-web/surfaces/browser-port";
import {
  DRAWER_AGENT_ID_PARAM,
  DRAWER_OPEN_PARAM,
  UiAgentHost,
} from "../src/features/agent/behavior/agent-host.adapter";

const agents = {} as AgentBrowserPort;

function hostWith(query: Record<string, string | undefined>) {
  const setQuery = vi.fn();
  const host = UiAgentHost.create(
    {
      project: { id: "project_1", slug: "acme", name: "Acme" },
      agents,
      copyTargets: [],
      route: { params: { project: "acme" }, query },
    },
    {
      setQuery,
      navigate: vi.fn(),
      succeeded: vi.fn(),
      failed: vi.fn(),
      describeFailure: () => "something went wrong",
    },
  );
  return { host, setQuery };
}

describe("given the Agents host", () => {
  describe("when the screen opens an editor for one agent", () => {
    it("writes the address the rest of the product produces for it", () => {
      const { host, setQuery } = hostWith({});

      host.openAgentEditor({ drawer: "agentHttpEditor", agentId: "agent_1" });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "agentHttpEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_1",
      });
    });

    it("keeps the query the reader already had", () => {
      const { host, setQuery } = hostWith({ history: "agent_9", tab: "all" });

      host.openAgentEditor({ drawer: "agentCodeEditor", agentId: "agent_2" });

      expect(setQuery).toHaveBeenCalledWith({
        history: "agent_9",
        tab: "all",
        [DRAWER_OPEN_PARAM]: "agentCodeEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_2",
      });
    });

    /** @scenario "A stale editor address is cleared before a new one is written" */
    it("drops a previous drawer's parameters rather than opening on its agent", () => {
      const { host, setQuery } = hostWith({
        [DRAWER_OPEN_PARAM]: "agentWorkflowEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_before",
        "drawer.workflowId": "wf_1",
        tab: "all",
      });

      host.openAgentEditor({ drawer: "agentHttpEditor", agentId: "agent_after" });

      expect(setQuery).toHaveBeenCalledWith({
        tab: "all",
        [DRAWER_OPEN_PARAM]: "agentHttpEditor",
        [DRAWER_AGENT_ID_PARAM]: "agent_after",
      });
    });
  });

  describe("when the screen opens an editor for an agent that does not exist yet", () => {
    it("names the drawer and no agent", () => {
      const { host, setQuery } = hostWith({});

      host.openAgentEditor({ drawer: "agentCodeEditor" });

      expect(setQuery).toHaveBeenCalledWith({ [DRAWER_OPEN_PARAM]: "agentCodeEditor" });
    });
  });

  describe("when a surface too tight for a toast reports a failure", () => {
    it("hands back the same copy the toast would have shown", () => {
      const { host } = hostWith({});

      expect(
        host.describeFailure({ error: new Error("boom"), fallbackTitle: "Couldn't load replicas" }),
      ).toBe("something went wrong");
    });
  });
});
