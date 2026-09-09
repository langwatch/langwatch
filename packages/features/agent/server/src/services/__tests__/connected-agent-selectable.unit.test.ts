/** @see specs/agents/connected-agents.feature */
import type { ConnectedAgentOwner } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import {
  ConnectedAgentPresenceService,
  type AgentPresence,
} from "../connected-agent-presence.service.ts";

const NO_OWNERS = new Map<string, ConnectedAgentOwner>();
const NO_PRESENCE_MAP = new Map<string, AgentPresence>();

function view({
  ownerUserId,
  viewerUserId,
}: {
  ownerUserId: string | null;
  viewerUserId: string | null;
}) {
  return ConnectedAgentPresenceService.agentPresenceView({
    agent: { id: "agent_1", ownerUserId },
    owners: NO_OWNERS,
    presence: NO_PRESENCE_MAP,
    viewerUserId,
  });
}

describe("given a personal development agent", () => {
  describe("when somebody else lists the project's agents", () => {
    /** @scenario "A row the caller cannot choose is listed and marked" */
    it("marks the row as not selectable and names the reason", () => {
      const row = view({ ownerUserId: "u_1", viewerUserId: "u_2" });

      expect(row.owner?.userId).toBe("u_1");
      expect(row.selectable).toBe(false);
      expect(row.notSelectableReason).toBe("owned_by_another_person");
    });
  });

  describe("when its owner lists the project's agents", () => {
    /** @scenario "A row the caller can choose is marked selectable" */
    it("marks the row as selectable", () => {
      const row = view({ ownerUserId: "u_1", viewerUserId: "u_1" });

      expect(row.selectable).toBe(true);
      expect(row.notSelectableReason).toBeNull();
    });
  });

  describe("when a key that names no person lists the project's agents", () => {
    /** @scenario "A personal row is not selectable by a key that names no person" */
    it("marks the row as not selectable", () => {
      const row = view({ ownerUserId: "u_1", viewerUserId: null });

      expect(row.selectable).toBe(false);
    });
  });
});

describe("given a host-scoped development agent", () => {
  describe("when a key that names no person lists the project's agents", () => {
    /** @scenario "A host-scoped row is selectable by anybody in the project" */
    it("marks the row as selectable", () => {
      const row = view({ ownerUserId: null, viewerUserId: null });

      expect(row.owner).toBeNull();
      expect(row.selectable).toBe(true);
      expect(row.notSelectableReason).toBeNull();
    });
  });
});
