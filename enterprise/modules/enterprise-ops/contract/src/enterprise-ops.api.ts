// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CreateSelfHostedNoticeInput,
  SelfHostedNoticeView,
  UpdateSelfHostedNoticeInput,
  ActivationCodePage,
  ActivationCodeView,
  IssuedActivationCode,
  IssuedLicenseFilters,
  IssuedLicensePage,
  IssuedLicenseView,
  LicenseCustomer,
  LicenseTermsInput,
  SeatChangeResult,
  SelfHostedInstanceDetail,
  SelfHostedInstanceFilters,
  SelfHostedInstancePage,
  SelfHostedInstanceSummary,
  UpgradeDiagnosticsDownload,
  UpgradeDiagnosticsReport,
  SignedIssuedLicense,
} from "@langwatch/enterprise-licensing-contract";
import { moduleApi } from "@langwatch/module";
import type { OpsOperator } from "@langwatch/ops-contract";

/**
 * The operator views over enterprise subjects (ARCHITECTURE.md section 3): each op admits
 * Cloud admin staff through OpsApi, then forwards to the owner's Api.
 */
export interface EnterpriseOpsApi {
  // -- the license registry (ADR-156) ------------------------------------------

  listIssuedLicenses(
    input: {
      page: number;
      pageSize: number;
      search?: string;
      operator: OpsOperator | null;
    } & IssuedLicenseFilters,
  ): Promise<IssuedLicensePage>;
  getIssuedLicense(input: { id: string; operator: OpsOperator | null }): Promise<IssuedLicenseView>;
  issueLicense(input: {
    customer: LicenseCustomer;
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    /** ISO 8601. The instant the term ends. */
    expiresAt: string;
    terms?: LicenseTermsInput;
    operator: OpsOperator | null;
  }): Promise<SignedIssuedLicense>;
  registerLegacyLicense(input: {
    licenseKey: string;
    organizationId: string;
    operator: OpsOperator | null;
  }): Promise<IssuedLicenseView>;
  revokeIssuedLicense(input: {
    id: string;
    reason: string;
    operator: OpsOperator | null;
  }): Promise<IssuedLicenseView>;
  reissueLicense(input: {
    id: string;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    /** ISO 8601. The instant the new term ends. */
    expiresAt: string;
    operator: OpsOperator | null;
  }): Promise<SignedIssuedLicense>;
  changeLicenseSeats(input: {
    id: string;
    maxMembers: number;
    operator: OpsOperator | null;
  }): Promise<SeatChangeResult>;
  resetLicenseInstanceBinding(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<IssuedLicenseView>;
  updateLicenseTerms(
    input: { id: string; operator: OpsOperator | null } & LicenseTermsInput,
  ): Promise<IssuedLicenseView>;
  linkLicenseToOrganization(input: {
    id: string;
    organizationId: string;
    operator: OpsOperator | null;
  }): Promise<IssuedLicenseView>;

  // -- activation codes (ADR-156, section 5) -----

  listActivationCodes(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
    operator: OpsOperator | null;
  }): Promise<ActivationCodePage>;
  issueActivationCode(input: {
    organizationId: string;
    organizationName: string;
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite?: number;
    licenseTermDays: number;
    services?: string[];
    /** ISO 8601. The instant the code stops working. */
    expiresAt: string;
    reusable?: boolean;
    operator: OpsOperator | null;
  }): Promise<IssuedActivationCode>;
  revokeActivationCode(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<ActivationCodeView>;

  // -- the registry of self-hosted installs (ADR-156, section 10); read only --

  listSelfHostedInstances(
    input: {
      page: number;
      pageSize: number;
      search?: string;
      operator: OpsOperator | null;
    } & SelfHostedInstanceFilters,
  ): Promise<SelfHostedInstancePage>;
  getSelfHostedInstance(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<SelfHostedInstanceDetail>;
  summarizeSelfHostedInstances(input: {
    operator: OpsOperator | null;
  }): Promise<SelfHostedInstanceSummary>;
  /** The upgrade diagnostics one install sent, newest first. */
  findUpgradeDiagnostics(input: {
    instanceRowId: string;
    operator: OpsOperator | null;
  }): Promise<UpgradeDiagnosticsReport[]>;
  /** A five-minute link to one bundle: the sensitive read, so it asks `ops:manage`. */
  getUpgradeDiagnosticsDownload(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<UpgradeDiagnosticsDownload>;

  // -- notices to self-hosted installs (self-hosted-notices.feature); writes ask ops:manage --

  listSelfHostedNotices(input: { operator: OpsOperator | null }): Promise<SelfHostedNoticeView[]>;
  createSelfHostedNotice(
    input: CreateSelfHostedNoticeInput & { operator: OpsOperator | null },
  ): Promise<SelfHostedNoticeView>;
  updateSelfHostedNotice(
    input: UpdateSelfHostedNoticeInput & { operator: OpsOperator | null },
  ): Promise<SelfHostedNoticeView>;
  publishSelfHostedNotice(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<SelfHostedNoticeView>;
  withdrawSelfHostedNotice(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<SelfHostedNoticeView>;
}

export const EnterpriseOpsApi = moduleApi<EnterpriseOpsApi>()("enterprise-ops");
