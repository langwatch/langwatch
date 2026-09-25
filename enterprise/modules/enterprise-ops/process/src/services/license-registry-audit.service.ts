// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The backoffice license registry: every read and command lands on the audit
 * log, a refusal included, and no entry ever carries a license key.
 */
import type { AuditLogApi, AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type {
  ActivationCodePage,
  ActivationCodeView,
  IssuedActivationCode,
  IssuedLicensePage,
  IssuedLicenseView,
  LicenseTermsInput,
  SeatChangeResult,
  SignedIssuedLicense,
  LicensingApi,
} from "@langwatch/enterprise-licensing-contract";

type AuditArgs = Readonly<Record<string, AuditLogJsonValue>>;
type TargetKind = "issuedLicense" | "activationCode";
type Staff = Readonly<{ operatorId: string }>;

/** The registry operations an operator reaches, as licensing serves them. */
export type LicenseRegistry = Pick<
  LicensingApi,
  | "listIssuedLicenses"
  | "getIssuedLicense"
  | "issueLicense"
  | "registerLegacyLicense"
  | "revokeIssuedLicense"
  | "reissueLicense"
  | "changeLicenseSeats"
  | "resetLicenseInstanceBinding"
  | "updateLicenseTerms"
  | "linkLicenseToOrganization"
  | "listActivationCodes"
  | "issueActivationCode"
  | "revokeActivationCode"
>;

export class LicenseRegistryAuditService {
  static create(deps: {
    registry: LicenseRegistry;
    auditLog: Pick<AuditLogApi, "record">;
  }): LicenseRegistryAuditService {
    return new LicenseRegistryAuditService(deps.registry, deps.auditLog);
  }

  private constructor(
    private readonly registry: LicenseRegistry,
    private readonly auditLog: Pick<AuditLogApi, "record">,
  ) {}

  async list(
    input: Staff & { page: number; pageSize: number; search?: string },
  ): Promise<IssuedLicensePage> {
    const { operatorId, ...query } = input;
    await this.record(operatorId, "getAll", {
      args: { page: query.page, pageSize: query.pageSize, hasSearch: Boolean(query.search) },
    });
    return this.registry.listIssuedLicenses(query);
  }

  async getById(input: Staff & { id: string }): Promise<IssuedLicenseView> {
    await this.record(input.operatorId, "getById", { args: { id: input.id }, targetId: input.id });
    return this.registry.getIssuedLicense({ id: input.id });
  }

  async issue(input: Parameters<LicenseRegistry["issueLicense"]>[0]): Promise<SignedIssuedLicense> {
    const asked = {
      planType: input.planType,
      maxMembers: input.maxMembers,
      expiresAt: input.expiresAt,
    };
    const result = await this.audited({
      operatorId: input.operatorId,
      action: "issue",
      entry: { args: asked },
      run: () => this.registry.issueLicense(input),
    });
    await this.record(input.operatorId, "issue", {
      args: { organizationId: result.license.organizationId, ...asked },
      targetId: result.license.id,
    });
    return result;
  }

  async registerLegacy(
    input: Parameters<LicenseRegistry["registerLegacyLicense"]>[0],
  ): Promise<IssuedLicenseView> {
    const args = { organizationId: input.organizationId };
    const license = await this.audited({
      operatorId: input.operatorId,
      action: "registerLegacy",
      entry: { args },
      run: () => this.registry.registerLegacyLicense(input),
    });
    await this.record(input.operatorId, "registerLegacy", { args, targetId: license.id });
    return license;
  }

  async revoke(
    input: Parameters<LicenseRegistry["revokeIssuedLicense"]>[0],
  ): Promise<IssuedLicenseView> {
    const entry = { args: { id: input.id, reason: input.reason }, targetId: input.id };
    const license = await this.audited({
      operatorId: input.operatorId,
      action: "revoke",
      entry: entry,
      run: () => this.registry.revokeIssuedLicense(input),
    });
    await this.record(input.operatorId, "revoke", entry);
    return license;
  }

  async reissue(
    input: Parameters<LicenseRegistry["reissueLicense"]>[0],
  ): Promise<SignedIssuedLicense> {
    const asked = { args: { replaces: input.id, expiresAt: input.expiresAt }, targetId: input.id };
    const result = await this.audited({
      operatorId: input.operatorId,
      action: "reissue",
      entry: asked,
      run: () => this.registry.reissueLicense(input),
    });
    await this.record(input.operatorId, "reissue", {
      args: {
        replaces: input.id,
        maxMembers: result.license.maxMembers,
        expiresAt: input.expiresAt,
      },
      targetId: result.license.id,
    });
    return result;
  }

  async changeSeats(
    input: Parameters<LicenseRegistry["changeLicenseSeats"]>[0],
  ): Promise<SeatChangeResult> {
    const asked = {
      args: { replaces: input.id, maxMembers: input.maxMembers },
      targetId: input.id,
    };
    const result = await this.audited({
      operatorId: input.operatorId,
      action: "changeSeats",
      entry: asked,
      run: () => this.registry.changeLicenseSeats(input),
    });
    await this.record(input.operatorId, "changeSeats", {
      args: {
        replaces: input.id,
        previousMaxMembers: result.previousMaxMembers,
        maxMembers: result.license.maxMembers,
        billing: result.billing,
      },
      targetId: result.license.id,
    });
    return result;
  }

  async resetInstanceBinding(input: Staff & { id: string }): Promise<IssuedLicenseView> {
    const entry = { args: { id: input.id }, targetId: input.id };
    const license = await this.audited({
      operatorId: input.operatorId,
      action: "resetInstanceBinding",
      entry: entry,
      run: () => this.registry.resetLicenseInstanceBinding({ id: input.id }),
    });
    await this.record(input.operatorId, "resetInstanceBinding", entry);
    return license;
  }

  async updateTerms(input: Staff & { id: string } & LicenseTermsInput): Promise<IssuedLicenseView> {
    const { operatorId, id, ...terms } = input;
    const license = await this.audited({
      operatorId: operatorId,
      action: "updateTerms",
      entry: { args: { id }, targetId: id },
      run: () => this.registry.updateLicenseTerms(input),
    });
    await this.record(operatorId, "updateTerms", {
      args: { id, ...definedTerms(terms) },
      targetId: id,
    });
    return license;
  }

  async linkToOrganization(
    input: Parameters<LicenseRegistry["linkLicenseToOrganization"]>[0],
  ): Promise<IssuedLicenseView> {
    const entry = {
      args: { id: input.id, organizationId: input.organizationId },
      targetId: input.id,
    };
    const license = await this.audited({
      operatorId: input.operatorId,
      action: "linkToOrganization",
      entry: entry,
      run: () => this.registry.linkLicenseToOrganization(input),
    });
    await this.record(input.operatorId, "linkToOrganization", entry);
    return license;
  }

  async activationCodes(
    input: Staff & { page: number; pageSize: number; organizationId?: string },
  ): Promise<ActivationCodePage> {
    const { operatorId, ...query } = input;
    await this.record(operatorId, "activationCodes", {
      args: { page: query.page, pageSize: query.pageSize },
      targetKind: "activationCode",
    });
    return this.registry.listActivationCodes(query);
  }

  async issueActivationCode(
    input: Parameters<LicenseRegistry["issueActivationCode"]>[0],
  ): Promise<IssuedActivationCode> {
    const asked = {
      organizationId: input.organizationId,
      planType: input.planType,
      reusable: input.reusable ?? false,
    };
    const result = await this.audited({
      operatorId: input.operatorId,
      action: "issueActivationCode",
      entry: { args: asked },
      run: () => this.registry.issueActivationCode(input),
    });
    await this.record(input.operatorId, "issueActivationCode", {
      args: {
        organizationId: input.organizationId,
        planType: input.planType,
        expiresAt: input.expiresAt,
      },
      targetKind: "activationCode",
      targetId: result.row.id,
    });
    return result;
  }

  async revokeActivationCode(
    input: Parameters<LicenseRegistry["revokeActivationCode"]>[0],
  ): Promise<ActivationCodeView> {
    const row = await this.audited({
      operatorId: input.operatorId,
      action: "revokeActivationCode",
      entry: { args: { id: input.id }, targetId: input.id },
      run: () => this.registry.revokeActivationCode(input),
    });
    await this.record(input.operatorId, "revokeActivationCode", {
      args: { id: input.id },
      targetKind: "activationCode",
      targetId: input.id,
    });
    return row;
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
    entry: { args: AuditArgs; targetKind?: TargetKind; targetId?: string; error?: string },
  ): Promise<void> {
    await this.auditLog.record({
      userId: operatorId,
      action: `licenseRegistry.${action}`,
      args: entry.args,
      targetKind: entry.targetKind ?? "issuedLicense",
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    });
  }
}

/** The terms an operator actually set; an absent field is not written as a key. */
function definedTerms(terms: LicenseTermsInput): AuditArgs {
  const args: Record<string, AuditLogJsonValue> = {};
  for (const [key, value] of Object.entries(terms)) {
    if (value !== undefined) args[key] = value;
  }
  return args;
}
