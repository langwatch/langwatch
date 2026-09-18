// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimSyncLifecycleState } from "@langwatch/identity";

export interface ScimSyncStatusCopy {
  headline: string;
  waitingFor: string;
  tone: "waiting" | "working" | "attention" | "ended";
}

export interface ReconciliationFailure {
  title: string;
  description: string;
  occurredAtMs: number;
  retired: boolean;
}

export interface ReconciliationChange {
  grantId: string;
  summary: string;
  author: string;
  occurredAtMs: number;
  kind: "attached" | "removed";
}

export interface ConnectionReconciliation {
  connectionId: string;
  providerId: string;
  verifiedDomains: string[];
  connectionState: string;
  state: ScimSyncLifecycleState | null;
  status: ScimSyncStatusCopy;
  lastPushedAtMs: number | null;
  managedPeople: number;
  failures: ReconciliationFailure[];
  remediation: string;
}

export interface OrganizationReconciliation {
  connections: ConnectionReconciliation[];
  recentChanges: ReconciliationChange[];
}

export interface DirectoryActivityEntryView {
  eventId: string;
  summary: string;
  occurredAtMs: number;
  outcome: "ok" | "refused";
}
