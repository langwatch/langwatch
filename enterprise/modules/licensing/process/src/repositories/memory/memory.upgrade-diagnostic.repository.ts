// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { UpgradeDiagnosticsNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import {
  type UpgradeDiagnosticInsert,
  type UpgradeDiagnosticRecord,
  UpgradeDiagnosticRepository,
} from "../upgrade-diagnostic.repository.ts";

/** The report rows, held in this process. */
export class MemoryUpgradeDiagnosticRepository extends UpgradeDiagnosticRepository {
  static create(): MemoryUpgradeDiagnosticRepository {
    return new MemoryUpgradeDiagnosticRepository();
  }

  readonly rows: UpgradeDiagnosticRecord[] = [];

  private constructor() {
    super();
  }

  async insert(row: UpgradeDiagnosticInsert): Promise<void> {
    this.rows.push({ ...row, slackAnnouncedAt: null });
  }

  async findAllByInstanceId(instanceId: string): Promise<UpgradeDiagnosticRecord[]> {
    return this.rows
      .filter((row) => row.instanceId === instanceId)
      .sort((a, b) => b.receivedAt.epochMilliseconds - a.receivedAt.epochMilliseconds);
  }

  async findAllForStep({
    instanceId,
    stepId,
    release,
  }: {
    instanceId: string;
    stepId: string;
    release: string | null;
  }): Promise<UpgradeDiagnosticRecord[]> {
    return this.rows
      .filter(
        (row) => row.instanceId === instanceId && row.stepId === stepId && row.release === release,
      )
      .sort((a, b) => a.receivedAt.epochMilliseconds - b.receivedAt.epochMilliseconds);
  }

  async getById(id: string): Promise<UpgradeDiagnosticRecord> {
    const row = this.rows.find((held) => held.id === id);
    if (!row) throw new UpgradeDiagnosticsNotFoundError();
    return row;
  }

  async markAnnounced({ id, at }: { id: string; at: Instant }): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];
    if (row) this.rows[index] = { ...row, slackAnnouncedAt: at };
  }
}
