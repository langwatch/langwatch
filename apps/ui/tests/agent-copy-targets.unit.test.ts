/**
 * Which projects the replication picker offers, and which of them it greys.
 *
 * `platform/app/src/hooks/useProjectsForCopy.ts` answered this by importing
 * `~/server/api/rbac` into a browser hook. `apps/ui` may not reach `~/server`,
 * so the answer is rebuilt over `@langwatch/authz-contract`, whose roles module
 * states in its own docblock that it is parity-tested against the rbac pair this
 * replaces. These assertions pin the four decisions that hook made, so a
 * divergence shows up as a red test rather than as a reader silently gaining or
 * losing a replication target.
 *
 * Spec: specs/agents/agent-management.feature
 */

import { describe, expect, it } from "vitest";
import { agentCopyTargets } from "../src/features/agent/model/agent-copy-targets";

const ME = "user_1";

function organization(
  teams: Parameters<typeof agentCopyTargets>[0]["organizations"][number]["teams"],
) {
  return { name: "Acme", teams };
}

describe("given the organization graph a reader belongs to", () => {
  describe("when a team's built-in role grants the agent permission", () => {
    it("offers every project on that team, selectable", () => {
      const targets = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Core",
              members: [{ userId: ME, role: "MEMBER" }],
              projects: [
                { id: "project_1", name: "Alpha" },
                { id: "project_2", name: "Beta" },
              ],
            },
          ]),
        ],
        userId: ME,
      });

      expect(targets).toEqual([
        { label: "Acme / Core / Alpha", value: "project_1", hasCreatePermission: true },
        { label: "Acme / Core / Beta", value: "project_2", hasCreatePermission: true },
      ]);
    });
  });

  describe("when a team's built-in role does not", () => {
    /** @scenario "Replication targets are the teams the reader may create agents in" */
    it("still lists the project, greyed", () => {
      const targets = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Readers",
              members: [{ userId: ME, role: "VIEWER" }],
              projects: [{ id: "project_3", name: "Gamma" }],
            },
          ]),
        ],
        userId: ME,
      });

      expect(targets).toEqual([
        { label: "Acme / Readers / Gamma", value: "project_3", hasCreatePermission: false },
      ]);
    });
  });

  describe("when a custom role carries its own permission list", () => {
    it("answers from that list, with the manage-implies rule", () => {
      const granted = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Custom",
              members: [
                {
                  userId: ME,
                  role: "CUSTOM",
                  assignedRole: { permissions: ["evaluations:manage"] },
                },
              ],
              projects: [{ id: "project_4", name: "Delta" }],
            },
          ]),
        ],
        userId: ME,
      });
      const refused = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Custom",
              members: [
                { userId: ME, role: "CUSTOM", assignedRole: { permissions: ["evaluations:view"] } },
              ],
              projects: [{ id: "project_4", name: "Delta" }],
            },
          ]),
        ],
        userId: ME,
      });

      expect(granted[0]?.hasCreatePermission).toBe(true);
      // The CUSTOM role's own list is authoritative; it does not fall through to
      // a built-in bag that would have said yes.
      expect(refused[0]?.hasCreatePermission).toBe(false);
    });

    it("falls back to the built-in role when the list is empty or absent", () => {
      const targets = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Core",
              members: [{ userId: ME, role: "ADMIN", assignedRole: { permissions: [] } }],
              projects: [{ id: "project_5", name: "Epsilon" }],
            },
          ]),
        ],
        userId: ME,
      });

      expect(targets[0]?.hasCreatePermission).toBe(true);
    });
  });

  describe("when the reader holds no membership row on a team", () => {
    /** @scenario "Replication targets are the teams the reader may create agents in" */
    it("offers none of that team's projects at all", () => {
      const targets = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Someone else's",
              members: [{ userId: "user_2", role: "ADMIN" }],
              projects: [{ id: "project_6", name: "Zeta" }],
            },
          ]),
        ],
        userId: ME,
      });

      expect(targets).toEqual([]);
    });
  });

  describe("when nobody is signed in yet", () => {
    it("offers nothing rather than everything", () => {
      const targets = agentCopyTargets({
        organizations: [
          organization([
            {
              name: "Core",
              members: [{ userId: ME, role: "ADMIN" }],
              projects: [{ id: "project_7", name: "Eta" }],
            },
          ]),
        ],
        userId: void 0,
      });

      expect(targets).toEqual([]);
    });
  });
});
