// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";

import type { AuditLogIntent } from "@langwatch/audit-log-contract";
import { GovernanceAwsConnectionNotFoundError } from "@langwatch/enterprise-governance-contract";
import { aesEncryption, type Encryption } from "@langwatch/process-stores";
import { nowInstant } from "@langwatch/time";

import { stopTimestamp } from "../../features/kill-switch/rules/agent-stop.rules.ts";
import {
  type GovernanceAwsConnectionRecord,
  GovernanceAwsConnectionRepository,
  type GovernanceAwsCredentials,
} from "../governance-aws-connection.repository.ts";

/** The row as the store keeps it: the secret and the external id sealed, like the Prisma tier. */
type MemoryAwsConnectionRow = {
  id: string;
  organizationId: string;
  name: string;
  accessKeyId: string | null;
  encryptedSecretAccessKey: string | null;
  roleArn: string | null;
  encryptedExternalId: string | null;
  createdAt: string;
};

function recordOf(row: MemoryAwsConnectionRow, cipher: Encryption): GovernanceAwsConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    accessKeyId: row.accessKeyId,
    roleArn: row.roleArn,
    externalId: row.encryptedExternalId === null ? null : cipher.decrypt(row.encryptedExternalId),
    createdAt: row.createdAt,
  };
}

export class MemoryGovernanceAwsConnectionRepository extends GovernanceAwsConnectionRepository {
  private readonly rows: MemoryAwsConnectionRow[] = [];

  private constructor(private readonly cipher: Encryption) {
    super();
  }

  static create({
    cipher = aesEncryption(randomBytes(32)),
  }: { cipher?: Encryption } = {}): MemoryGovernanceAwsConnectionRepository {
    return new MemoryGovernanceAwsConnectionRepository(cipher);
  }

  /** The audit intents committed with the writes, as the outbox holds them. */
  readonly auditIntents: AuditLogIntent[] = [];
  #auditRefusal: string | null = null;

  /** Test-only levers the repository interface never declares. */
  readonly testing = {
    /** The next audit append throws `message`, so its write rolls back as a transaction would. */
    refuseNextAudit: (message: string): void => {
      this.#auditRefusal = message;
    },
    /** The rows as stored, sealed values included, for a test to read. */
    storedRows: (): MemoryAwsConnectionRow[] => structuredClone(this.rows),
  };

  private commitAudit(audit: AuditLogIntent): void {
    const refusal = this.#auditRefusal;
    this.#auditRefusal = null;
    if (refusal) throw new Error(refusal);
    this.auditIntents.push(audit);
  }

  async create(input: {
    id: string;
    organizationId: string;
    name: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    roleArn: string | null;
    externalId: string | null;
    audit: AuditLogIntent;
  }): Promise<GovernanceAwsConnectionRecord> {
    const row: MemoryAwsConnectionRow = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      accessKeyId: input.accessKeyId,
      encryptedSecretAccessKey:
        input.secretAccessKey === null ? null : this.cipher.encrypt(input.secretAccessKey),
      roleArn: input.roleArn,
      encryptedExternalId: input.externalId === null ? null : this.cipher.encrypt(input.externalId),
      createdAt: stopTimestamp(nowInstant().epochMilliseconds),
    };
    this.commitAudit(input.audit);
    this.rows.push(row);
    return recordOf(row, this.cipher);
  }

  async findAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GovernanceAwsConnectionRecord[]> {
    return this.rows
      .filter((row) => row.organizationId === organizationId)
      .map((row) => recordOf(row, this.cipher));
  }

  async findByIds({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: readonly string[];
  }): Promise<GovernanceAwsConnectionRecord[]> {
    return this.rows
      .filter((row) => row.organizationId === organizationId && ids.includes(row.id))
      .map((row) => recordOf(row, this.cipher));
  }

  async getCredentials({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<GovernanceAwsCredentials> {
    const row = this.rows.find(
      (candidate) => candidate.organizationId === organizationId && candidate.id === id,
    );
    if (!row) throw new GovernanceAwsConnectionNotFoundError(id);
    return {
      accessKeyId: row.accessKeyId,
      secretAccessKey:
        row.encryptedSecretAccessKey === null
          ? null
          : this.cipher.decrypt(row.encryptedSecretAccessKey),
      roleArn: row.roleArn,
      externalId:
        row.encryptedExternalId === null ? null : this.cipher.decrypt(row.encryptedExternalId),
    };
  }

  async delete({
    organizationId,
    id,
    audit,
    whileLocked,
  }: {
    organizationId: string;
    id: string;
    audit: AuditLogIntent;
    whileLocked?: () => Promise<void>;
  }): Promise<boolean> {
    await whileLocked?.();
    const index = this.rows.findIndex(
      (row) => row.organizationId === organizationId && row.id === id,
    );
    if (index < 0) return false;
    this.commitAudit(audit);
    this.rows.splice(index, 1);
    return true;
  }
}
