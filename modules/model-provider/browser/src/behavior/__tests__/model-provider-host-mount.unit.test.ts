import { describe, expect, it } from "vitest";

import { scopesFromGraph } from "../model-provider-host-mount.tsx";

const organizations = [
  { id: "org-other", name: "Other", teams: [] },
  {
    id: "org-1",
    name: "Acme",
    teams: [
      { id: "team-a", name: "Alpha", projects: [{ id: "p-1", name: "One" }] },
      {
        id: "team-b",
        name: "Beta",
        projects: [
          { id: "p-2", name: "Two" },
          { id: "p-3", name: "Three" },
        ],
      },
    ],
  },
];

describe("scopesFromGraph", () => {
  describe("when the active organization is in the graph", () => {
    it("offers every team and project the reader reaches, project names suffixed with their team", () => {
      expect(scopesFromGraph({ organizations, organizationId: "org-1" })).toEqual({
        organization: { id: "org-1", name: "Acme" },
        teams: [
          { id: "team-a", name: "Alpha" },
          { id: "team-b", name: "Beta" },
        ],
        projects: [
          { id: "p-1", name: "One · Alpha", teamId: "team-a" },
          { id: "p-2", name: "Two · Beta", teamId: "team-b" },
          { id: "p-3", name: "Three · Beta", teamId: "team-b" },
        ],
      });
    });
  });

  describe("when the graph has not loaded or lacks the organization", () => {
    it("returns null so the host falls back to the current scope", () => {
      expect(scopesFromGraph({ organizations: [], organizationId: "org-1" })).toBeNull();
      expect(scopesFromGraph({ organizations, organizationId: undefined })).toBeNull();
    });
  });
});
