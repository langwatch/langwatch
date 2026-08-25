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
import { composeInvitesFromFlags, parseInvitesJson } from "../managementInvites";

describe("composeInvitesFromFlags", () => {
  describe("when one role covers the whole batch", () => {
    it("applies that role to every invite and the teams to every invite", () => {
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
  });

  describe("when a role is given per email", () => {
    it("pairs roles with emails one for one", () => {
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
  });

  describe("when the batch is missing a team to land on", () => {
    it("refuses it, naming the flag that carries one", () => {
      expect(() =>
        composeInvitesFromFlags({ email: ["a@example.com"], role: ["MEMBER"] }),
      ).toThrow(/--team teamId:role/);
    });
  });

  describe("when a team assignment is malformed", () => {
    it("refuses it by naming the shape", () => {
      expect(() =>
        composeInvitesFromFlags({
          email: ["a@example.com"],
          role: ["MEMBER"],
          team: ["team_1"],
        }),
      ).toThrow(/Expected teamId:role/);
    });
  });

  describe("when an email flag is not an address", () => {
    /** @scenario A mistyped invite email is refused before the batch is sent */
    it("refuses the batch rather than sending an address nobody can be invited at", () => {
      for (const malformed of [
        "not-an-email",
        "person@example",
        "person example@acme.com",
        "@example.com",
        "person@",
      ]) {
        const parse = (): unknown =>
          composeInvitesFromFlags({
            email: [malformed],
            role: ["MEMBER"],
            team: ["team_1:MEMBER"],
          });

        expect(parse).toThrow(ManagementFlagError);
        expect(parse).toThrow(/Expected an address like person@example.com/);
      }
    });
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

  describe("when the document is a well formed batch", () => {
    it("accepts a bare array and the invites envelope the API answers with", () => {
      expect(parseInvitesJson(JSON.stringify(batch))).toEqual(batch);
      expect(parseInvitesJson(JSON.stringify({ invites: batch }))).toEqual(batch);
    });
  });

  describe("when the document is not an invite batch", () => {
    it("refuses it, saying what is missing", () => {
      expect(() => parseInvitesJson("{oops")).toThrow(/Invalid JSON/);
      expect(() => parseInvitesJson('"nope"')).toThrow(/expected a JSON array/);
      expect(() => parseInvitesJson("[]")).toThrow(/empty/);
      expect(() => parseInvitesJson('[{"role":"MEMBER"}]')).toThrow(/no email/);
      expect(() => parseInvitesJson('[{"email":"a@b.c"}]')).toThrow(/no role/);
      expect(() => parseInvitesJson('[{"email":"a@b.c","role":"MEMBER"}]')).toThrow(
        /no teams/,
      );
    });
  });

  describe("when an invite carries an email that is not an address", () => {
    /** @scenario A mistyped invite email is refused before the batch is sent */
    it("refuses that invite by number", () => {
      const invite = (email: string): unknown => ({
        email,
        role: "MEMBER",
        teams: [{ teamId: "team_1", role: "MEMBER" }],
      });
      const document = JSON.stringify([invite("a@example.com"), invite("not-an-email")]);

      expect(() => parseInvitesJson(document)).toThrow(ManagementFlagError);
      expect(() => parseInvitesJson(document)).toThrow(
        /Invalid email "not-an-email" in invite 2/,
      );
    });
  });

  describe("when a custom role id is not a role id", () => {
    it("refuses it", () => {
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
});
