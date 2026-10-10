/**
 * Which projects a key's own grants reach, and which projects they name outright.
 */
import type { ProjectIdentity } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { bindingsReachProject, findGrantedProjectIds } from "../api-key-grant-reach.rules.ts";

const project: ProjectIdentity = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

describe("bindingsReachProject", () => {
  it("reaches every project in a bound organization", () => {
    expect(bindingsReachProject([{ scopeType: "ORGANIZATION", scopeId: "org-1" }], project)).toBe(
      true,
    );
  });

  it("reaches every project on a bound team", () => {
    expect(bindingsReachProject([{ scopeType: "TEAM", scopeId: "team-1" }], project)).toBe(true);
  });

  it("reaches only its own project through a project binding", () => {
    expect(bindingsReachProject([{ scopeType: "PROJECT", scopeId: "project-1" }], project)).toBe(
      true,
    );
    expect(bindingsReachProject([{ scopeType: "PROJECT", scopeId: "project-2" }], project)).toBe(
      false,
    );
  });

  it("does not reach a project through another organization or team", () => {
    expect(
      bindingsReachProject(
        [
          { scopeType: "ORGANIZATION", scopeId: "org-2" },
          { scopeType: "TEAM", scopeId: "team-2" },
        ],
        project,
      ),
    ).toBe(false);
    expect(bindingsReachProject([], project)).toBe(false);
  });

  it("never reads a team id as a project id", () => {
    expect(bindingsReachProject([{ scopeType: "TEAM", scopeId: "project-1" }], project)).toBe(
      false,
    );
  });
});

describe("findGrantedProjectIds", () => {
  it("answers the distinct project bindings in first-seen order", () => {
    expect(
      findGrantedProjectIds([
        { scopeType: "PROJECT", scopeId: "project-2" },
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
        { scopeType: "PROJECT", scopeId: "project-1" },
        { scopeType: "PROJECT", scopeId: "project-2" },
        { scopeType: "TEAM", scopeId: "team-1" },
      ]),
    ).toEqual(["project-2", "project-1"]);
  });

  it("answers none for organization and team bindings alone", () => {
    expect(
      findGrantedProjectIds([
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
        { scopeType: "TEAM", scopeId: "team-1" },
      ]),
    ).toEqual([]);
  });
});
