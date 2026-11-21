/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  hangsOnItsCreator,
  isMarkedPersonal,
  type VirtualKeyOwnership,
} from "../gateway-personal-key.rules.ts";

const unmarked = (createdById: string): VirtualKeyOwnership => ({
  principalUserId: null,
  mintedAsPersonal: false,
  createdById,
});

describe("the personal-key rule", () => {
  describe("given a key with a principal, or minted with one", () => {
    /** @scenario "A key minted for a person stays personal after its principal is cleared" */
    it("is personal on its own columns, the principal cleared or not", () => {
      expect(isMarkedPersonal({ ...unmarked("usr_1"), principalUserId: "usr_1" })).toBe(true);
      expect(isMarkedPersonal({ ...unmarked("usr_1"), mintedAsPersonal: true })).toBe(true);
      expect(hangsOnItsCreator({ ...unmarked("usr_1"), mintedAsPersonal: true })).toBe(false);
    });
  });

  describe("given an unmarked key a person created", () => {
    /** @scenario "A key with no owner whose creator's account is gone counts as personal on a budget's detail" */
    it("turns on whether its creator's account still exists", () => {
      expect(isMarkedPersonal(unmarked("usr_1"))).toBe(false);
      expect(hangsOnItsCreator(unmarked("usr_1"))).toBe(true);
    });
  });

  describe("given an unmarked key a project credential created", () => {
    /** @scenario "A key a machine created never counts as personal on a budget's detail" */
    it("never turns on its creator, whose id is no account", () => {
      expect(hangsOnItsCreator(unmarked("svc_project_1"))).toBe(false);
    });
  });
});
