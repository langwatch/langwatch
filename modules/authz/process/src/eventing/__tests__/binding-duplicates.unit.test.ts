/**
 * Bindings are never unique: an identical attach is a second grant, and only
 * a caller that asks to skip leaves one out.
 * @see modules/authz/specs/bindings-are-never-unique.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOR,
  binding,
  harness,
  ORG_ID,
  storedGrantRow,
} from "./support/eventing.authz-ledger-fork.harness.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

const again = { ...binding, bindingId: "rb_2" };

describe("given a user who already holds Member on a team", () => {
  describe("when the same binding is attached again", () => {
    /** @scenario "An identical binding is attached as a second grant" */
    it("writes a second grant without reading the existing ones", async () => {
      const { writer, db, sent } = harness({});
      db.grant.findMany.mockResolvedValue([storedGrantRow()]);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [again],
        actor: ACTOR,
        onDuplicate: "attach",
        awaitProjection: false,
      });

      expect(outcome).toEqual({ attached: ["rb_2"], duplicates: [] });
      expect(db.grant.findMany).not.toHaveBeenCalled();
      expect(sent.map((command) => command.verb)).toEqual(["attachGrant"]);
    });
  });

  describe("when the caller asks to skip what is already held", () => {
    /** @scenario "A re-assertion that asks to skip leaves an identical binding out" */
    it("writes nothing and answers the held grant as the duplicate", async () => {
      const { writer, db, sent } = harness({});
      db.grant.findMany.mockResolvedValue([storedGrantRow()]);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [again],
        actor: ACTOR,
        onDuplicate: "skip",
        awaitProjection: false,
      });

      expect(outcome).toEqual({ attached: [], duplicates: ["rb_1"] });
      expect(sent).toEqual([]);
    });
  });
});

describe("given a binding changed to a role a sibling already holds", () => {
  /** @scenario "Changing a binding to a role a sibling already holds is written" */
  it("sends the role change rather than refusing it", async () => {
    const { writer, db, sent } = harness({});
    db.grant.findFirst.mockResolvedValue(storedGrantRow());

    let code: unknown = null;
    try {
      await writer.changeBindingRole({
        organizationId: ORG_ID,
        bindingId: "rb_1",
        role: "ADMIN",
        customRoleId: null,
        actor: ACTOR,
      });
    } catch (error) {
      code = HandledError.isHandled(error) ? error.code : error;
    }

    expect(code).not.toBe("role_binding_already_exists");
    expect(sent.map((command) => command.verb)).toEqual(["changeGrantRole"]);
  });
});
