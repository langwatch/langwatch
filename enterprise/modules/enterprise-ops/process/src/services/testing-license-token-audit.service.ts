// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The testing-licence tokens as ops managers reach them (ADR-180 section 2): every read and
 * command lands on the audit log, a refusal included, and no entry ever carries a token.
 */
import type { AuditLogApi, AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type {
  LicensingApi,
  MintedTestingLicenseToken,
  TestingLicenseTokenPage,
  TestingLicenseTokenView,
} from "@langwatch/enterprise-licensing-contract";

type AuditArgs = Readonly<Record<string, AuditLogJsonValue>>;
type Staff = Readonly<{ operatorId: string }>;

/** The token operations an ops manager reaches, as licensing serves them. */
type TestingLicenseTokens = Pick<
  LicensingApi,
  "listTestingLicenseTokens" | "createTestingLicenseServiceToken" | "revokeTestingLicenseToken"
>;

export class TestingLicenseTokenAuditService {
  static create(deps: {
    tokens: TestingLicenseTokens;
    auditLog: Pick<AuditLogApi, "record">;
  }): TestingLicenseTokenAuditService {
    return new TestingLicenseTokenAuditService(deps.tokens, deps.auditLog);
  }

  private constructor(
    private readonly tokens: TestingLicenseTokens,
    private readonly auditLog: Pick<AuditLogApi, "record">,
  ) {}

  async list(input: Staff & { page: number; pageSize: number }): Promise<TestingLicenseTokenPage> {
    const query = { page: input.page, pageSize: input.pageSize };
    await this.record({ operatorId: input.operatorId, action: "list", args: query });
    return this.tokens.listTestingLicenseTokens(query);
  }

  /** The token is shown to the ops manager once; the trail keeps its name and expiry only. */
  async createService(
    input: Staff & { name: string; expiresInDays?: number },
  ): Promise<MintedTestingLicenseToken> {
    const args = {
      name: input.name,
      ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
    };
    const minted = await this.audited({
      operatorId: input.operatorId,
      action: "createServiceToken",
      args,
      run: () => this.tokens.createTestingLicenseServiceToken(input),
    });
    await this.record({
      operatorId: input.operatorId,
      action: "createServiceToken",
      args,
      targetId: minted.testingLicenseToken.id,
    });
    return minted;
  }

  async revoke(input: Staff & { id: string }): Promise<TestingLicenseTokenView> {
    const args = { id: input.id };
    const revoked = await this.audited({
      operatorId: input.operatorId,
      action: "revoke",
      args,
      targetId: input.id,
      run: () => this.tokens.revokeTestingLicenseToken(input),
    });
    await this.record({ operatorId: input.operatorId, action: "revoke", args, targetId: input.id });
    return revoked;
  }

  /** Runs a command; a refusal is recorded with what was asked, then rethrown. */
  private async audited<T>({
    run,
    ...entry
  }: {
    operatorId: string;
    action: string;
    args: AuditArgs;
    targetId?: string;
    run: () => Promise<T>;
  }): Promise<T> {
    try {
      return await run();
    } catch (error) {
      await this.record({
        ...entry,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async record({
    operatorId,
    action,
    args,
    targetId,
    error,
  }: {
    operatorId: string;
    action: string;
    args: AuditArgs;
    targetId?: string;
    error?: string;
  }): Promise<void> {
    await this.auditLog.record({
      userId: operatorId,
      action: `testingLicenseTokens.${action}`,
      args,
      targetKind: "testingLicenseToken",
      ...(targetId === undefined ? {} : { targetId }),
      ...(error === undefined ? {} : { error }),
    });
  }
}
