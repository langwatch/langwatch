// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { scimTestApp } from "../../transport/__tests__/support/scim-app.fixture.ts";

const MOVE = {
  organizationId: "org_acme",
  fromConnectionId: "ssoc_legacy",
  toConnectionId: "ssoc_direct",
};

class RecordingSender {
  readonly sent: unknown[] = [];
  async send(payload: unknown): Promise<void> {
    this.sent.push(payload);
  }
}

describe("moveToConnection", () => {
  describe("given the directory pipeline is connected", () => {
    /** @scenario "A finished move asks scim for the directory move as a command on its own pipeline" */
    it("sends one requestDirectoryMove command tenanted by the organization", async () => {
      const { app } = scimTestApp();
      const sender = new RecordingSender();
      app.connectDirectory({ requestDirectoryMove: sender });

      await app.moveToConnection(MOVE);

      expect(sender.sent).toEqual([
        expect.objectContaining({ ...MOVE, tenantId: "org_acme", occurredAt: expect.any(Number) }),
      ]);
    });
  });

  describe("given no directory pipeline was registered", () => {
    /** @scenario "A directory move asked of a process without scim's directory pipeline is refused by name" */
    it("refuses naming the pipeline", async () => {
      const { app } = scimTestApp();

      await expect(app.moveToConnection(MOVE)).rejects.toThrow(/scim_directory/);
    });
  });
});
