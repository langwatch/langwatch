// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Instant } from "@langwatch/time";

import { upgradeDiagnosticsObjectKey } from "../../rules/upgrade-diagnostics.rules.ts";
import { UpgradeDiagnosticBundleRepository } from "../upgrade-diagnostic-bundle.repository.ts";

/** Bundles held by key in this process; a signed link names the key and its expiry. */
export class MemoryUpgradeDiagnosticBundleRepository extends UpgradeDiagnosticBundleRepository {
  static create(): MemoryUpgradeDiagnosticBundleRepository {
    return new MemoryUpgradeDiagnosticBundleRepository();
  }

  readonly objects = new Map<string, Uint8Array>();

  private constructor() {
    super();
  }

  async write({
    instanceId,
    reportId,
    body,
  }: {
    instanceId: string;
    reportId: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string }> {
    const objectKey = upgradeDiagnosticsObjectKey({ instanceId, reportId });
    this.objects.set(objectKey, body);
    return { objectKey };
  }

  async signDownload({
    objectKey,
    expiresAt,
  }: {
    objectKey: string;
    expiresAt: Instant;
  }): Promise<string> {
    return `memory://upgrade-diagnostics-bundles/${objectKey}?expires=${expiresAt.toString()}`;
  }
}
