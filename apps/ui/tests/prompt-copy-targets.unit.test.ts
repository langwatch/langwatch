/**
 * Which projects the prompt replication picker offers.
 *
 * The answer is per TEAM rather than per current scope, and it is rebuilt over
 * `@langwatch/authz-contract`'s published rules because the platform hook read
 * `~/server/api/rbac`, which a browser package may not reach. What is worth
 * asserting is the two ways a project drops out — no membership row at all, and
 * a membership whose role does not grant `prompts:create` — because both are
 * silent: a picker that got either wrong offers a target the server then
 * refuses.
 *
 * Spec: specs/prompts/prompt-studio-page.feature
 */

import { describe, expect, it } from "vitest";
import {
  PROMPT_COPY_PERMISSION,
  promptCopyTargets,
  type PromptCopyOrganization,
} from "../src/features/prompt/model/prompt-copy-targets";

const USER = "user_1";

const organization = (teams: PromptCopyOrganization["teams"]): PromptCopyOrganization => ({
  name: "Acme",
  teams,
});

const project = (id: string) => ({ id, name: `Project ${id}`, slug: `project-${id}` });

describe("promptCopyTargets", () => {
  describe("given the reader is not signed in", () => {
    it("offers nothing", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([
              {
                name: "Platform",
                members: [{ userId: USER, role: "ADMIN" }],
                projects: [project("p1")],
              },
            ]),
          ],
          userId: void 0,
        }),
      ).toEqual([]);
    });
  });

  describe("given a team the reader administers", () => {
    /** @scenario "Replicating a prompt offers only projects the reader may create in" */
    it("offers its projects, named by their whole path", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([
              {
                name: "Platform",
                members: [{ userId: USER, role: "ADMIN" }],
                projects: [project("p1")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([
        {
          id: "p1",
          name: "Acme / Platform / Project p1",
          slug: "project-p1",
          teamName: "Platform",
        },
      ]);
    });
  });

  describe("given a team the reader is not a member of", () => {
    it("offers none of its projects", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([{ name: "Platform", members: [], projects: [project("p1")] }]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });

  describe("given a team the reader can only view", () => {
    /** @scenario "Replicating a prompt offers only projects the reader may create in" */
    it("offers none of its projects, because a viewer may not create a prompt", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([
              {
                name: "Platform",
                members: [{ userId: USER, role: "VIEWER" }],
                projects: [project("p1")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });

  describe("given a custom role that names the grant outright", () => {
    it("offers the team's projects", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([
              {
                name: "Platform",
                members: [
                  {
                    userId: USER,
                    role: "CUSTOM",
                    assignedRole: { permissions: [PROMPT_COPY_PERMISSION] },
                  },
                ],
                projects: [project("p1")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toHaveLength(1);
    });
  });

  describe("given a custom role whose permission list names something else", () => {
    it("offers nothing", () => {
      expect(
        promptCopyTargets({
          organizations: [
            organization([
              {
                name: "Platform",
                members: [
                  {
                    userId: USER,
                    role: "CUSTOM",
                    assignedRole: { permissions: ["datasets:create"] },
                  },
                ],
                projects: [project("p1")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });
});
