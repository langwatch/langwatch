// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Cloud's row per received upgrade diagnostics bundle; the bytes live in object storage. */
import type { Instant } from "@langwatch/time";

export type UpgradeDiagnosticRecord = Readonly<{
  id: string;
  instanceId: string;
  stepId: string;
  stepDescription: string | null;
  release: string | null;
  attempt: number;
  trigger: "operator" | "automatic";
  byteLength: number;
  objectKey: string;
  receivedAt: Instant;
  expiresAt: Instant;
  slackAnnouncedAt: Instant | null;
}>;

export type UpgradeDiagnosticInsert = Omit<UpgradeDiagnosticRecord, "slackAnnouncedAt">;

export abstract class UpgradeDiagnosticRepository {
  abstract insert(row: UpgradeDiagnosticInsert): Promise<void>;
  /** Every report of one instance, newest first. */
  abstract findAllByInstanceId(instanceId: string): Promise<UpgradeDiagnosticRecord[]>;
  /** Every report of one step on one release from one instance, oldest first. */
  abstract findAllForStep(input: {
    instanceId: string;
    stepId: string;
    release: string | null;
  }): Promise<UpgradeDiagnosticRecord[]>;
  /** One report; an unknown id throws `upgrade_diagnostics_not_found`. */
  abstract getById(id: string): Promise<UpgradeDiagnosticRecord>;
  abstract markAnnounced(input: { id: string; at: Instant }): Promise<void>;
}
