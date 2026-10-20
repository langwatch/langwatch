// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The install end of upgrade diagnostics, over the memory licence host.
 * Spec: enterprise/modules/licensing/specs/upgrade-diagnostics.feature
 */
import type { ConnectCredential } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { upgradeDiagnosticsSubmission } from "../../__tests__/support/upgrade-diagnostics.fixture.ts";
import { MemoryConnectLicenseChannel } from "../../channels/memory/memory.connect-license.channel.ts";
import { UpgradeDiagnosticsSenderService } from "../upgrade-diagnostics-sender.service.ts";

const credential: ConnectCredential = { token: `lwl_${"a".repeat(64)}`, instanceId: "install-1" };

function sender({ connect, credentials }: { connect: boolean; credentials: ConnectCredential[] }) {
  const host = MemoryConnectLicenseChannel.create({
    diagnosticsAnswer: { reportId: "report-1", receivedAt: "2026-10-20T10:00:00Z" },
  });
  const service = UpgradeDiagnosticsSenderService.create({
    install: { findInstallCredential: async () => credentials },
    ...(connect ? { host } : {}),
  });
  return { service, host };
}

describe("UpgradeDiagnosticsSenderService", () => {
  describe("when the install's licence carries a Connect credential", () => {
    /** @scenario "An install sends a bundle to the licence host with its licence credential" */
    it("sends the submission with the licence token and instance id and answers the receipt", async () => {
      const { service, host } = sender({ connect: true, credentials: [credential] });
      const submission = upgradeDiagnosticsSubmission();

      await expect(service.send(submission)).resolves.toEqual({
        reportId: "report-1",
        receivedAt: "2026-10-20T10:00:00Z",
      });
      expect(host.diagnostics).toEqual([
        { token: credential.token, instanceId: "install-1", submission },
      ]);
    });
  });

  describe("when Connect is switched off", () => {
    /** @scenario "Sending is refused when Connect is switched off" */
    it("refuses as connect_disabled and sends nothing", async () => {
      const { service, host } = sender({ connect: false, credentials: [credential] });

      await expect(service.send(upgradeDiagnosticsSubmission())).rejects.toMatchObject({
        code: "connect_disabled",
      });
      expect(host.diagnostics).toEqual([]);
    });
  });

  describe("when the install holds no licence", () => {
    /** @scenario "Sending is refused when the install holds no licence" */
    it("refuses as upgrade_diagnostics_license_required", async () => {
      const { service, host } = sender({ connect: true, credentials: [] });

      await expect(service.send(upgradeDiagnosticsSubmission())).rejects.toMatchObject({
        code: "upgrade_diagnostics_license_required",
      });
      expect(host.diagnostics).toEqual([]);
    });
  });

  describe("when asked whether sending is available", () => {
    /** @scenario "An install tells whether sending is available and why not" */
    it("answers connect_disabled, no_licence, or available", async () => {
      await expect(
        sender({ connect: false, credentials: [credential] }).service.availability(),
      ).resolves.toEqual({ available: false, reason: "connect_disabled" });
      await expect(
        sender({ connect: true, credentials: [] }).service.availability(),
      ).resolves.toEqual({ available: false, reason: "no_licence" });
      await expect(
        sender({ connect: true, credentials: [credential] }).service.availability(),
      ).resolves.toEqual({ available: true, reason: null });
    });
  });
});
