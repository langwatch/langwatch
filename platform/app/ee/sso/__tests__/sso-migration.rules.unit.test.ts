// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { scimStatusOf } from "../sso-migration.rules";

describe("scimStatusOf", () => {
  describe("given the previous connection's directory sync is pushing today", () => {
    /** @scenario "Finishing moves the previous connection's directory sync across" */
    it("says the sync moves across with the finish rather than asking anyone to repoint it", () => {
      expect(
        scimStatusOf({ legacySyncs: true, replacementSyncState: null }),
      ).toBe("moves-with-finish");
    });

    it("is ready once the replacement has a token, whether or not a push has landed yet", () => {
      expect(
        scimStatusOf({
          legacySyncs: true,
          replacementSyncState: "TOKEN_ISSUED",
        }),
      ).toBe("ready");
      expect(
        scimStatusOf({ legacySyncs: true, replacementSyncState: "SYNCING" }),
      ).toBe("ready");
    });
  });

  describe("given no directory sync pushes through the previous connection", () => {
    it("has nothing to move", () => {
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: null }),
      ).toBe("not-applicable");
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: "REVOKED" }),
      ).toBe("not-applicable");
    });

    it("is ready when the customer set the replacement's sync up themselves", () => {
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: "SYNCING" }),
      ).toBe("ready");
    });
  });
});
