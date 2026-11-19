import { describe, expect, it } from "vitest";

import { personalTeamName, personalTeamOwnerName } from "../personal-workspace.ts";

describe("personalTeamOwnerName", () => {
  describe("when the team carries its owner in its name", () => {
    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("reads the owner back out of the name personalTeamName wrote", () => {
      expect(personalTeamOwnerName({ teamName: personalTeamName({ ownerLabel: "Sam Lee" }) })).toBe(
        "Sam Lee",
      );
    });
  });

  describe("when the team's name does not carry an owner", () => {
    /** @scenario A personal team that no longer carries its owner in its name shows the whole team name */
    it("returns the whole team name", () => {
      expect(personalTeamOwnerName({ teamName: "Lab bench" })).toBe("Lab bench");
      expect(personalTeamOwnerName({ teamName: "'s Workspace" })).toBe("'s Workspace");
    });
  });
});
