import { describe, expect, it } from "vitest";

import { isListedInSwitcher, isOwnPersonalTeam } from "../personal-team.ts";

const sharedTeam = { isPersonal: false, ownerUserId: null };
const personalTeamOf = (ownerUserId: string) => ({ isPersonal: true, ownerUserId });

describe("isListedInSwitcher", () => {
  describe("when the team is shared", () => {
    it("lists it", () => {
      expect(isListedInSwitcher(sharedTeam, "user_admin")).toBe(true);
    });
  });

  describe("when the team is the reader's own personal workspace", () => {
    it("lists it", () => {
      expect(isListedInSwitcher(personalTeamOf("user_admin"), "user_admin")).toBe(true);
    });
  });

  describe("when the team is a colleague's personal workspace", () => {
    it("keeps it out of the list", () => {
      expect(isListedInSwitcher(personalTeamOf("user_jane"), "user_admin")).toBe(false);
    });
  });
});

describe("isOwnPersonalTeam", () => {
  describe("when the reader is not known yet", () => {
    it("claims no personal team, even one with no owner", () => {
      expect(isOwnPersonalTeam({ isPersonal: true }, void 0)).toBe(false);
    });
  });
});
