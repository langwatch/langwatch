/** Spec: specs/self-hosting/checkup/startup-notice.feature */
import { describe, expect, it } from "vitest";

import { startupNoticeState } from "../startup-notice.rules.ts";

describe("startupNoticeState", () => {
  describe("given a self-hosted install with reporting left on", () => {
    /** @scenario "A fresh install shows the notice to an administrator" */
    it("shows the notice where no identity was ever minted", () => {
      const state = startupNoticeState({
        isSaas: false,
        usageReportsDisabled: false,
        acknowledgedSchemaVersion: undefined,
        schemaVersion: 2,
      });

      expect(state).toEqual({ show: true, schemaVersion: 2 });
    });

    /** @scenario "The notice comes back when the report schema version moves" */
    it("shows the notice again once the schema version moved past the acknowledged one", () => {
      const state = startupNoticeState({
        isSaas: false,
        usageReportsDisabled: false,
        acknowledgedSchemaVersion: 1,
        schemaVersion: 2,
      });

      expect(state.show).toBe(true);
    });

    /** @scenario "A dismissed notice stays dismissed across restarts and browsers" */
    it("stays dismissed for the schema version that was acknowledged", () => {
      const state = startupNoticeState({
        isSaas: false,
        usageReportsDisabled: false,
        acknowledgedSchemaVersion: 2,
        schemaVersion: 2,
      });

      expect(state.show).toBe(false);
    });
  });

  describe("when reporting is off or the deployment is LangWatch Cloud", () => {
    /** @scenario "The notice is never shown on LangWatch Cloud or with reporting switched off" */
    it("never shows the notice", () => {
      const disabled = { isSaas: false, usageReportsDisabled: true };
      const cloud = { isSaas: true, usageReportsDisabled: false };

      for (const deployment of [disabled, cloud]) {
        expect(
          startupNoticeState({
            ...deployment,
            acknowledgedSchemaVersion: undefined,
            schemaVersion: 3,
          }).show,
        ).toBe(false);
      }
    });
  });
});
