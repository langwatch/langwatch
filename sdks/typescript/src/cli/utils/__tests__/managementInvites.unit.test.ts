/**
 * The invite grammar: the batch repeated flags describe, the batch a JSON
 * document describes, and what a malformed one of either is refused with.
 *
 * Parsed directly rather than through the command, because both spellings must
 * land on the same request and a refusal must say which invite was wrong.
 *
 * @see specs/typescript-sdk/cli-management-apis.feature
 */
import { describe, expect, it } from "vitest";
import { ManagementFlagError } from "../managementFlags";
import {
  composeInvitesFromFlags,
  parseInvitesJson,
} from "../managementInvites";

describe("composeInvitesFromFlags", () => {
  it("applies one role to the whole batch and the teams to every invite", () => {
    expect(
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com"],
        role: ["MEMBER"],
        team: ["team_1:MEMBER", "team_2:VIEWER"],
      }),
    ).toEqual([
      {
        email: "a@example.com",
        role: "MEMBER",
        teams: [
          { teamId: "team_1", role: "MEMBER" },
          { teamId: "team_2", role: "VIEWER" },
        ],
      },
      {
        email: "b@example.com",
        role: "MEMBER",
        teams: [
          { teamId: "team_1", role: "MEMBER" },
          { teamId: "team_2", role: "VIEWER" },
        ],
      },
    ]);
  });

  it("pairs roles with emails one for one when several are given", () => {
    expect(
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com"],
        role: ["ADMIN", "MEMBER"],
        team: ["team_1:MEMBER"],
      }).map((invite) => invite.role),
    ).toEqual(["ADMIN", "MEMBER"]);
  });

  it("refuses a role count that lines up with nothing", () => {
    expect(() =>
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com", "c@example.com"],
        role: ["ADMIN", "MEMBER"],
        team: ["team_1:MEMBER"],
      }),
    ).toThrow(/one --role for the whole batch, or one per --email/);
  });

  it("refuses a batch with no team to land on", () => {
    expect(() =>
      composeInvitesFromFlags({ email: ["a@example.com"], role: ["MEMBER"] }),
    ).toThrow(/--team teamId:role/);
  });

  it("refuses a malformed team assignment by naming the shape", () => {
    expect(() =>
      composeInvitesFromFlags({
        email: ["a@example.com"],
        role: ["MEMBER"],
        team: ["team_1"],
      }),
    ).toThrow(/Expected teamId:role/);
  });
});

describe("parseInvitesJson", () => {
  const batch = [
    {
      email: "a@example.com",
      role: "MEMBER",
      teams: [{ teamId: "team_1", role: "MEMBER", customRoleId: "role_1" }],
    },
  ];

  it("accepts a bare array and the invites envelope the API answers with", () => {
    expect(parseInvitesJson(JSON.stringify(batch))).toEqual(batch);
    expect(parseInvitesJson(JSON.stringify({ invites: batch }))).toEqual(batch);
  });

  it("refuses a document that is not an invite batch", () => {
    expect(() => parseInvitesJson("{oops")).toThrow(/Invalid JSON/);
    expect(() => parseInvitesJson('"nope"')).toThrow(/expected a JSON array/);
    expect(() => parseInvitesJson("[]")).toThrow(/empty/);
    expect(() => parseInvitesJson('[{"role":"MEMBER"}]')).toThrow(/no email/);
    expect(() => parseInvitesJson('[{"email":"a@b.c"}]')).toThrow(/no role/);
    expect(() =>
      parseInvitesJson('[{"email":"a@b.c","role":"MEMBER"}]'),
    ).toThrow(/no teams/);
  });

  it("refuses a custom role id that is not a role id", () => {
    const withCustomRoleId = (customRoleId: unknown): string =>
      JSON.stringify([
        {
          email: "a@example.com",
          role: "MEMBER",
          teams: [{ teamId: "team_1", role: "CUSTOM", customRoleId }],
        },
      ]);

    for (const malformed of [42, {}, [], "", "   "]) {
      expect(() => parseInvitesJson(withCustomRoleId(malformed))).toThrow(
        ManagementFlagError,
      );
      expect(() => parseInvitesJson(withCustomRoleId(malformed))).toThrow(
        /customRoleId that is not a role id/,
      );
    }
  });
});
