import { describe, expect, it } from "vitest";

import { isOwnPersonalWorkspace } from "../annotation-personal-workspace.ts";

const graph = [
  {
    teams: [
      { isPersonal: false, ownerUserId: null, projects: [{ id: "shared" }] },
      { isPersonal: true, ownerUserId: "alice", projects: [{ id: "alice-home" }] },
    ],
  },
];

describe("isOwnPersonalWorkspace", () => {
  it("opens for the owner standing in their personal project", () => {
    expect(isOwnPersonalWorkspace({ graph, projectId: "alice-home", userId: "alice" })).toBe(true);
  });

  it("stays shut for someone else in that personal project", () => {
    expect(isOwnPersonalWorkspace({ graph, projectId: "alice-home", userId: "bob" })).toBe(false);
  });

  it("stays shut in a shared team's project", () => {
    expect(isOwnPersonalWorkspace({ graph, projectId: "shared", userId: "alice" })).toBe(false);
  });

  it("stays shut before the graph or the reader resolves", () => {
    expect(isOwnPersonalWorkspace({ graph: [], projectId: "alice-home", userId: "alice" })).toBe(
      false,
    );
    expect(isOwnPersonalWorkspace({ graph, projectId: "alice-home", userId: void 0 })).toBe(false);
  });
});
