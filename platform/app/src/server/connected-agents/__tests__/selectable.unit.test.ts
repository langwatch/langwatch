/**
 * What a listing says about a connected agent row the caller may read but may
 * not run, and that the run refuses exactly the rows the listing marks.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import type { AgentIdentityRow } from "~/server/agents/agent.repository";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import { agentPresenceView } from "../presence.read";
import { connectedAgentSelectability } from "../selectable";

const NO_OWNERS = new Map<string, { userId: string; name: string | null }>();
const NO_PRESENCE_MAP = new Map<
  string,
  { status: "online" | "offline"; instances: [] }
>();

function view({
  ownerUserId,
  viewerUserId,
}: {
  ownerUserId: string | null;
  viewerUserId: string | null;
}) {
  return agentPresenceView({
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

describe("given the listing mark and the run refusal read the same agents", () => {
  /** @scenario "The listing mark and the run refusal read one rule" */
  it("refuses exactly the agents the listing marks as not selectable", async () => {
    const agents: Pick<
      AgentIdentityRow,
      "id" | "name" | "type" | "ownerUserId"
    >[] = [
      { id: "a_1", name: "shared", type: "connected", ownerUserId: null },
      { id: "a_2", name: "mine", type: "connected", ownerUserId: "u_1" },
      { id: "a_3", name: "theirs", type: "connected", ownerUserId: "u_2" },
    ];
    const users = {
      user: { findMany: async () => [{ id: "u_2", name: "Ana" }] },
    } as unknown as Parameters<
      typeof assertConnectedAgentsRunnable
    >[0]["users"];

    for (const agent of agents) {
      const marked = connectedAgentSelectability({
        ownerUserId: agent.ownerUserId,
        viewerUserId: "u_1",
      }).selectable;
      const refused = await assertConnectedAgentsRunnable({
        agents: [agent],
        actor: { id: "u_1", label: "user" },
        users,
      }).then(
        () => false,
        () => true,
      );

      expect(refused).toBe(!marked);
    }
  });
});
