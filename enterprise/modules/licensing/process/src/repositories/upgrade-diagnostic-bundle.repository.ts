// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The received bundles' bytes, kept under an expiring prefix (ADR-172). */
import type { Instant } from "@langwatch/time";

export abstract class UpgradeDiagnosticBundleRepository {
  /** Writes the bundle's JSON and answers where it went. */
  abstract write(input: {
    instanceId: string;
    reportId: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string }>;
  /** A GET link to one stored bundle that stops working at `expiresAt`. */
  abstract signDownload(input: { objectKey: string; expiresAt: Instant }): Promise<string>;
}
