import { describe, expect, it } from "vitest";

import { teamNameTaken } from "../team-name.rules.ts";

const teams = [{ id: "t1", name: "Platform" }];

describe("teamNameTaken", () => {
  it("matches trimmed and case-insensitively", () => {
    expect(teamNameTaken({ name: "  platform ", teams })).toBe(true);
  });

  it("does not match another name", () => {
    expect(teamNameTaken({ name: "Data", teams })).toBe(false);
  });

  it("ignores the team being renamed", () => {
    expect(teamNameTaken({ name: "PLATFORM", teams, exceptTeamId: "t1" })).toBe(false);
  });
});
