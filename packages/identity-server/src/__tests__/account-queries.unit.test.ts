import { describe, expect, it } from "vitest";
import {
  parseAccountQuery,
  UnsupportedAccountQueryError,
} from "../better-auth/account-queries";

const parse = (where: Array<Record<string, unknown>>) =>
  parseAccountQuery({ operation: "findOne", where: where as never });

describe("the account query surface", () => {
  describe("given the shapes better-auth actually issues", () => {
    /** @scenario "The account adapter answers only the shapes it knows" */
    it("recognises the IdP callback's (providerId, subject) lookup", () => {
      // better-auth calls the PROVIDER's subject `accountId`; the row id is
      // `id`. Reading those two the wrong way round is the mistake this
      // whole module exists to make impossible.
      expect(
        parse([
          { field: "accountId", value: "sub-12345" },
          { field: "providerId", value: "google" },
        ]),
      ).toEqual({
        kind: "byProviderAccount",
        provider: "google",
        providerAccountId: "sub-12345",
      });
    });

    it("recognises a row-id lookup and an id IN list", () => {
      expect(parse([{ field: "id", value: "acc_1" }])).toEqual({
        kind: "byId",
        id: "acc_1",
      });
      expect(
        parse([{ field: "id", operator: "in", value: ["acc_1", "acc_2"] }]),
      ).toEqual({ kind: "byIds", ids: ["acc_1", "acc_2"] });
    });

    it("recognises the account list and the password reset", () => {
      expect(parse([{ field: "userId", value: "user_sam" }])).toEqual({
        kind: "byUser",
        userId: "user_sam",
      });
      expect(
        parse([
          { field: "userId", value: "user_sam" },
          { field: "providerId", value: "credential" },
        ]),
      ).toEqual({
        kind: "byUserAndProvider",
        userId: "user_sam",
        provider: "credential",
      });
    });
  });

  describe("given a shape this adapter cannot answer", () => {
    /** @scenario "An unanswerable account query refuses instead of guessing" */
    it("throws naming the shape, rather than answering nothing", () => {
      // Answering null here would read exactly like "no such account", which
      // is how a person gets told their sign-in method does not exist.
      expect(() => parse([{ field: "scope", value: "openid" }])).toThrow(
        UnsupportedAccountQueryError,
      );
      expect(() => parse([{ field: "scope", value: "openid" }])).toThrow(
        /scope/,
      );
    });

    it("refuses an OR predicate, which would silently widen the match", () => {
      expect(() =>
        parse([
          { field: "userId", value: "user_sam" },
          { field: "providerId", value: "google", connector: "OR" },
        ]),
      ).toThrow(UnsupportedAccountQueryError);
    });

    it("refuses a partial match rather than ignoring the extra clause", () => {
      expect(() =>
        parse([
          { field: "userId", value: "user_sam" },
          { field: "providerId", value: "google" },
          { field: "scope", value: "openid" },
        ]),
      ).toThrow(UnsupportedAccountQueryError);
    });

    it("refuses an empty predicate: it would mean every account there is", () => {
      expect(() => parse([])).toThrow(UnsupportedAccountQueryError);
    });
  });
});
