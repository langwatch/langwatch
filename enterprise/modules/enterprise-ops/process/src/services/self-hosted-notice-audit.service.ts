// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cloud admin's notices to self-hosted installs: every read and command lands on the audit log,
 * a refusal included, as the license registry's do.
 */
import type { AuditLogApi, AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type {
  CreateSelfHostedNoticeInput,
  LicensingApi,
  SelfHostedNoticeView,
  UpdateSelfHostedNoticeInput,
} from "@langwatch/enterprise-licensing-contract";

type AuditArgs = Readonly<Record<string, AuditLogJsonValue>>;
type Staff = Readonly<{ operatorId: string }>;

type Notices = Pick<
  LicensingApi,
  | "listSelfHostedNotices"
  | "createSelfHostedNotice"
  | "updateSelfHostedNotice"
  | "publishSelfHostedNotice"
  | "withdrawSelfHostedNotice"
>;

export class SelfHostedNoticeAuditService {
  static create(deps: {
    notices: Notices;
    auditLog: Pick<AuditLogApi, "record">;
  }): SelfHostedNoticeAuditService {
    return new SelfHostedNoticeAuditService(deps.notices, deps.auditLog);
  }

  private constructor(
    private readonly notices: Notices,
    private readonly auditLog: Pick<AuditLogApi, "record">,
  ) {}

  async list(input: Staff): Promise<SelfHostedNoticeView[]> {
    await this.record(input.operatorId, "getAll", { args: {} });
    return this.notices.listSelfHostedNotices();
  }

  async create(input: Staff & CreateSelfHostedNoticeInput): Promise<SelfHostedNoticeView> {
    const { operatorId, ...fields } = input;
    const args = writtenOf(fields);
    const notice = await this.audited({
      operatorId,
      action: "create",
      entry: { args },
      run: () => this.notices.createSelfHostedNotice(fields),
    });
    await this.record(operatorId, "create", { args, targetId: notice.id });
    return notice;
  }

  async update(input: Staff & UpdateSelfHostedNoticeInput): Promise<SelfHostedNoticeView> {
    const { operatorId, ...fields } = input;
    const entry = { args: { id: fields.id, ...writtenOf(fields) }, targetId: fields.id };
    const notice = await this.audited({
      operatorId,
      action: "update",
      entry,
      run: () => this.notices.updateSelfHostedNotice(fields),
    });
    await this.record(operatorId, "update", entry);
    return notice;
  }

  async publish(input: Staff & { id: string }): Promise<SelfHostedNoticeView> {
    const entry = { args: { id: input.id }, targetId: input.id };
    const notice = await this.audited({
      operatorId: input.operatorId,
      action: "publish",
      entry,
      run: () => this.notices.publishSelfHostedNotice(input),
    });
    await this.record(input.operatorId, "publish", entry);
    return notice;
  }

  async withdraw(input: Staff & { id: string }): Promise<SelfHostedNoticeView> {
    const entry = { args: { id: input.id }, targetId: input.id };
    const notice = await this.audited({
      operatorId: input.operatorId,
      action: "withdraw",
      entry,
      run: () => this.notices.withdrawSelfHostedNotice({ id: input.id }),
    });
    await this.record(input.operatorId, "withdraw", entry);
    return notice;
  }

  /** Runs a command; a refusal is recorded with what was asked, then rethrown. */
  private async audited<T>({
    operatorId,
    action,
    entry,
    run,
  }: {
    operatorId: string;
    action: string;
    entry: { args: AuditArgs; targetId?: string };
    run: () => Promise<T>;
  }): Promise<T> {
    try {
      return await run();
    } catch (error) {
      await this.record(operatorId, action, {
        ...entry,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async record(
    operatorId: string,
    action: string,
    entry: { args: AuditArgs; targetId?: string; error?: string },
  ): Promise<void> {
    await this.auditLog.record({
      userId: operatorId,
      action: `selfHostedNotices.${action}`,
      args: entry.args,
      targetKind: "selfHostedNotice",
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    });
  }
}

/** What a notice says, minus its body: the title and the facts an install acts on. */
function writtenOf(fields: CreateSelfHostedNoticeInput): AuditArgs {
  return {
    severity: fields.severity,
    title: fields.title,
    fixedIn: fields.fixedIn,
    expiresAt: fields.expiresAt,
  };
}
