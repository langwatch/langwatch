/**
 * @vitest-environment node
 *
 * The two guards standing between a key and a person's own usage data.
 *
 * Both refusals answer the same question, "whose data is this", so they are
 * pinned by `code` rather than by the sentence they carry: the words are copy
 * and the client renders its own, but the code is what a caller branches on.
 *
 * @see packages/api/src/rest/personal-caller.ts
 */

import { describe, expect, it } from "vitest";

import { resolvePersonalCaller } from "@langwatch/api/rest";

const OWNER_ID = "user_owner";

/** The refusal `code` a call raised, so a test never asserts on prose. */
function refusalCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("resolving who a personal-workspace read answers for", () => {
  describe("given a workspace that is not one person's", () => {
    describe("when the key names a shared or team project", () => {
      it("refuses, naming the personal key it needs instead", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: false, ownerUserId: null },
              apiKeyUserId: OWNER_ID,
            }),
          ),
        ).toBe("personal_project_key_required");
      });
    });

    describe("when the project is flagged personal but names no owner", () => {
      it("refuses rather than answering for nobody", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: true, ownerUserId: null },
              apiKeyUserId: OWNER_ID,
            }),
          ),
        ).toBe("personal_project_key_required");
      });
    });
  });

  describe("given a personal workspace somebody else owns", () => {
    describe("when a user-bound key is pointed at it", () => {
      it("refuses without saying whose workspace it is", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: true, ownerUserId: OWNER_ID },
              apiKeyUserId: "user_someone_else",
            }),
          ),
        ).toBe("personal_usage_key_mismatch");
      });
    });
  });

  describe("given a personal workspace the caller owns", () => {
    describe("when the key is bound to that user", () => {
      it("answers for the owner", () => {
        expect(
          resolvePersonalCaller({
            project: { isPersonal: true, ownerUserId: OWNER_ID },
            apiKeyUserId: OWNER_ID,
          }),
        ).toBe(OWNER_ID);
      });
    });

    describe("when the key carries no user of its own", () => {
      it("answers for the owner, since a project key IS that workspace's key", () => {
        expect(
          resolvePersonalCaller({
            project: { isPersonal: true, ownerUserId: OWNER_ID },
            apiKeyUserId: undefined,
          }),
        ).toBe(OWNER_ID);
      });
    });
  });
});
