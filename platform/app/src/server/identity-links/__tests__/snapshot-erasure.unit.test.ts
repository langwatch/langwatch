// @vitest-environment node
// ADR-094 Decision 9: erasure blanks person references inside
// `DiscoveredAgent.snapshot` payloads, and leaves everything the provider said
// about the bot itself alone.
import { describe, expect, it } from "vitest";

import {
  ERASED_SNAPSHOT_VALUE,
  eraseSnapshotPersonReferences,
} from "../snapshot-erasure";

const alice = {
  userId: "usr_alice",
  emails: ["alice@example.com"],
  providerActorIds: ["entra-obj-123"],
};

describe("eraseSnapshotPersonReferences", () => {
  describe("given a snapshot naming the person", () => {
    it("blanks the user id, the email and the provider actor id", () => {
      const { snapshot, changed } = eraseSnapshotPersonReferences(
        {
          displayName: "Support Bot",
          ownerUserId: "usr_alice",
          ownerEmail: "Alice@Example.com",
          createdByObjectId: "entra-obj-123",
          quarantined: false,
        },
        alice,
      );

      expect(changed).toBe(true);
      expect(snapshot).toEqual({
        // Provider-side state about the BOT is untouched — erasure forgets a
        // person, it does not degrade the inventory.
        displayName: "Support Bot",
        ownerUserId: ERASED_SNAPSHOT_VALUE,
        ownerEmail: ERASED_SNAPSHOT_VALUE,
        createdByObjectId: ERASED_SNAPSHOT_VALUE,
        quarantined: false,
      });
    });

    it("reaches into nested objects and arrays", () => {
      const { snapshot } = eraseSnapshotPersonReferences(
        {
          owners: [
            { email: "alice@example.com" },
            { email: "bob@example.com" },
          ],
          audit: { lastEditedBy: { uid: "usr_alice" } },
        },
        alice,
      );

      expect(snapshot).toEqual({
        owners: [
          { email: ERASED_SNAPSHOT_VALUE },
          { email: "bob@example.com" },
        ],
        audit: { lastEditedBy: { uid: ERASED_SNAPSHOT_VALUE } },
      });
    });

    describe("when the address is embedded in a longer string", () => {
      // A display string still names the person. Blanking the address and
      // keeping the rest is the honest middle: the sentence survives, the
      // identity does not.
      it("replaces the address and keeps the surrounding text", () => {
        const { snapshot } = eraseSnapshotPersonReferences(
          { note: "escalated to Alice <ALICE@example.com> on call" },
          alice,
        );
        expect(snapshot).toEqual({
          note: `escalated to Alice <${ERASED_SNAPSHOT_VALUE}> on call`,
        });
      });
    });

    describe("when the person's identifier is an object KEY", () => {
      // A provider that buckets state by owner names them in the key. A pass
      // that only walked values would report success with the name in plain
      // sight.
      it("blanks the key too", () => {
        const { snapshot, changed } = eraseSnapshotPersonReferences(
          { usageByOwner: { "alice@example.com": 12, "bob@example.com": 3 } },
          alice,
        );
        expect(changed).toBe(true);
        expect(snapshot).toEqual({
          usageByOwner: { [ERASED_SNAPSHOT_VALUE]: 12, "bob@example.com": 3 },
        });
      });
    });
  });

  describe("given a snapshot naming nobody", () => {
    it("changes nothing and says so, so no row is written or stamped", () => {
      const original = { displayName: "Support Bot", quarantined: true };
      const { snapshot, changed } = eraseSnapshotPersonReferences(
        original,
        alice,
      );
      expect(changed).toBe(false);
      expect(snapshot).toBe(original);
    });

    describe("when an opaque id merely appears inside another value", () => {
      // Opaque ids are short and high-entropy and turn up as fragments of
      // composite keys. A contains-rule there would blank inventory data that
      // names nobody, so only whole-value matches count.
      it("leaves the composite value alone", () => {
        const { changed } = eraseSnapshotPersonReferences(
          { environmentKey: "env-9/entra-obj-1234" },
          alice,
        );
        expect(changed).toBe(false);
      });
    });
  });

  describe("given a person with no identifiers at all", () => {
    it("does nothing rather than matching the empty string everywhere", () => {
      const original = { displayName: "Support Bot" };
      const { snapshot, changed } = eraseSnapshotPersonReferences(original, {
        userId: "",
        emails: [],
        providerActorIds: [],
      });
      expect(changed).toBe(false);
      expect(snapshot).toBe(original);
    });
  });

  describe("given a null snapshot", () => {
    it("passes it through untouched", () => {
      expect(eraseSnapshotPersonReferences(null, alice)).toEqual({
        snapshot: null,
        changed: false,
      });
    });
  });
});
