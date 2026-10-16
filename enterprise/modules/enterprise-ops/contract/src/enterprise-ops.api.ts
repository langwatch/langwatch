// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ActivationCodePage,
  ActivationCodeView,
  IssuedActivationCode,
  IssuedLicenseView,
  LicenseCustomer,
  LicenseTermsInput,
  SeatChangeResult,
  SelfHostedInstanceDetail,
  SelfHostedInstancePage,
  SignedIssuedLicense,
  MintedTestingLicenseToken,
  TestingLicenseTokenView,
} from "@langwatch/enterprise-licensing-contract";
import { moduleApi } from "@langwatch/module";
import type { OpsOperator } from "@langwatch/ops-contract";

import type {
  NamedIssuedLicensePage,
  NamedIssuedLicenseView,
  NamedTestingLicenseTokenPage,
} from "./license-registry.responses.ts";

/**
 * The operator views over enterprise subjects (ARCHITECTURE.md section 3): each op admits
 * Cloud admin staff through OpsApi, then forwards to the owner's Api.
 */
export interface EnterpriseOpsApi {
  // -- the license registry (ADR-156) ------------------------------------------

  listIssuedLicenses(input: {
    page: number;
    pageSize: number;
    search?: string;
    includeTesting?: boolean;
    operator: OpsOperator | null;
  }): Promise<NamedIssuedLicensePage>;
  getIssuedLicense(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<NamedIssuedLicenseView>;
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

  listSelfHostedInstances(input: {
    page: number;
    pageSize: number;
    search?: string;
    operator: OpsOperator | null;
  }): Promise<SelfHostedInstancePage>;
  getSelfHostedInstance(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<SelfHostedInstanceDetail>;

  // -- testing-licence tokens (ADR-180 section 2); ops managers only ------------

  listTestingLicenseTokens(input: {
    page: number;
    pageSize: number;
    operator: OpsOperator | null;
  }): Promise<NamedTestingLicenseTokenPage>;
  createTestingLicenseServiceToken(input: {
    name: string;
    expiresInDays?: number;
    operator: OpsOperator | null;
  }): Promise<MintedTestingLicenseToken>;
  revokeTestingLicenseToken(input: {
    id: string;
    operator: OpsOperator | null;
  }): Promise<TestingLicenseTokenView>;
}

export const EnterpriseOpsApi = moduleApi<EnterpriseOpsApi>()("enterprise-ops");
