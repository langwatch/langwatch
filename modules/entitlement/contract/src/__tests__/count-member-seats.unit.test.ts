import { OrganizationUserRole } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { countMemberSeats } from "../member-classification.ts";

describe("countMemberSeats", () => {
  it("counts each holder on the seat its role and permissions classify it to", () => {
    expect(
      countMemberSeats([
        { role: OrganizationUserRole.ADMIN, permissions: undefined },
        { role: OrganizationUserRole.MEMBER, permissions: undefined },
        { role: OrganizationUserRole.EXTERNAL, permissions: ["project:update"] },
        { role: OrganizationUserRole.EXTERNAL, permissions: ["project:view"] },
        { role: OrganizationUserRole.EXTERNAL, permissions: undefined },
        { role: OrganizationUserRole.DEVELOPER, permissions: ["project:update"] },
      ]),
    ).toEqual({ fullMembers: 3, liteMembers: 2, developers: 1 });
  });

  it("answers no seats for nobody", () => {
    expect(countMemberSeats([])).toEqual({
      fullMembers: 0,
      liteMembers: 0,
      developers: 0,
    });
  });

  it("counts a held seat as full unless its person holds a full seat again", () => {
    expect(
      countMemberSeats(
        [
          { role: OrganizationUserRole.MEMBER, permissions: undefined, userId: "back" },
          { role: OrganizationUserRole.EXTERNAL, permissions: undefined, userId: "demoted" },
        ],
        [{ userId: "back" }, { userId: "demoted" }, { userId: "removed" }, { userId: "removed" }],
      ),
    ).toEqual({ fullMembers: 3, liteMembers: 1, developers: 0 });
  });

  it("counts a held seat once when its person is invited back on a full seat", () => {
    expect(
      countMemberSeats(
        [
          {
            role: OrganizationUserRole.MEMBER,
            permissions: undefined,
            email: "Back@Example.com",
          },
        ],
        [{ userId: "back", email: "back@example.com" }],
      ),
    ).toEqual({ fullMembers: 1, liteMembers: 0, developers: 0 });
  });
});
