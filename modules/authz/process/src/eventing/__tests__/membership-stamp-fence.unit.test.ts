/**
 * The write half of the membership fence: what the writer locks, what the
 * command carries, and who is refused outright.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BindingMissingError } from "../../repositories/authz-grant.repository.ts";
import { ACTOR, binding, harness, ORG_ID } from "./support/eventing.authz-ledger-fork.harness.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a live attach naming a member", () => {
  /** @scenario "A live USER attach carries the membership lifetime it locked" */
  it("reads the lifetime under the membership row's own lock", async () => {
    const { writer, queryRaw } = harness({});

    await writer.attachBindings({
      organizationId: ORG_ID,
      bindings: [binding],
      actor: ACTOR,
      onDuplicate: "skip",
      awaitProjection: false,
    });

    const [query] = queryRaw.mock.calls[0] ?? [];
    const sql = (query?.sql ?? "").replace(/\s+/g, " ");
    expect(sql).toContain('FROM "OrganizationUser"');
    expect(sql).toContain('"disabledAt" IS NULL');
    expect(sql).toContain("FOR UPDATE");
  });
});

describe("given an attach naming a user with no live membership", () => {
  /** @scenario "A live USER attach carries the membership lifetime it locked" */
  it("refuses the batch rather than stating an unfenced grant", async () => {
    const { writer, queryRaw, sent } = harness({});
    queryRaw.mockResolvedValue([]);

    await expect(
      writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
        awaitProjection: false,
      }),
    ).rejects.toBeInstanceOf(BindingMissingError);
    expect(sent).toHaveLength(0);
  });
});

describe("given an imported binding", () => {
  /** @scenario "A live USER attach carries the membership lifetime it locked" */
  it("takes no live lock, because the import states the lifetime it read", async () => {
    const { writer, queryRaw, sent } = harness({});

    await writer.attachBindings({
      organizationId: ORG_ID,
      bindings: [{ ...binding, membershipStamp: "stamp_from_inventory" }],
      actor: ACTOR,
      source: "migration",
      onDuplicate: "skip",
      awaitProjection: false,
    });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(sent[0]?.data).toMatchObject({
      grant: { membershipStamp: "stamp_from_inventory" },
    });
  });
});

describe("given a bootstrap marker on a binding that is not a founder's", () => {
  /** @scenario "Only a founder's own admin grants may state their own lifetime" */
  it("refuses before any command is built", async () => {
    const { writer, sent } = harness({});

    await expect(
      writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [{ ...binding, membershipStamp: "stamp_1", membershipBootstrap: true }],
        actor: ACTOR,
        onDuplicate: "skip",
        awaitProjection: false,
      }),
    ).rejects.toThrow("membershipBootstrap");
    expect(sent).toHaveLength(0);
  });
});
