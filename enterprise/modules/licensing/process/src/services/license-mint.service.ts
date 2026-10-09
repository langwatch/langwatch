import {
  OrganizationNotFoundError,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, Temporal, toDate } from "@langwatch/time";

import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import type { OrganizationLicenseWriterService } from "./organization-license-writer.service.ts";

/** What an operator asks the mint for; everything left off comes from the plan template. */
export type LicenseMintRequest = Readonly<{
  organizationId: string;
  planType: string;
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  expiresAt?: Instant;
  email?: string;
}>;

type LicenseMintResult = Readonly<{
  organizationId: string;
  organizationName: string;
  planType: string;
  licenseId: string;
  expiresAt: string;
}>;

type LicenseMintPeers = Readonly<{
  licenses: Pick<LicensingApi, "generateLicenseKey" | "recordIssuedLicense">;
  organizations: Pick<OrganizationApi, "findProvisioningSummary">;
  storage: Pick<OrganizationLicenseWriterService, "store">;
  registry: Pick<IssuedLicenseRepository, "delete">;
}>;

/** Main's default: high enough that no realistic dev or QA organization meets the ceiling. */
const DEFAULT_MAX_MEMBERS = 50;

/**
 * Main's generate-license script: mints a license for an organization, records it in the
 * registry and stores it for the organization. A failed licence write, organization's columns
 * included, is compensated by deleting the registry row (license-registry.feature).
 */
export class LicenseMintService {
  static create(peers: LicenseMintPeers): LicenseMintService {
    return new LicenseMintService(peers);
  }

  private constructor(private readonly peers: LicenseMintPeers) {}

  async applyToOrganization(request: LicenseMintRequest): Promise<LicenseMintResult> {
    const organization = await this.peers.organizations.findProvisioningSummary(
      request.organizationId,
    );
    if (organization === null) throw new OrganizationNotFoundError();

    const { licenseKey, licenseData } = await this.peers.licenses.generateLicenseKey({
      organizationName: organization.name,
      email: request.email ?? `${organization.slug}@local.test`,
      planType: request.planType,
      maxMembers: request.maxMembers ?? DEFAULT_MAX_MEMBERS,
      ...(request.maxMembersLite === undefined ? {} : { maxMembersLite: request.maxMembersLite }),
      ...(request.maxMessagesPerMonth === undefined
        ? {}
        : { maxMessagesPerMonth: request.maxMessagesPerMonth }),
      ...(request.expiresAt === undefined ? {} : { expiresAt: toDate(request.expiresAt) }),
    });

    const row = await this.peers.licenses.recordIssuedLicense({
      licenseKey,
      source: "SCRIPT",
      organizationId: organization.id,
    });
    try {
      await this.peers.storage.store({
        organizationId: organization.id,
        license: {
          licenseKey,
          expiresAt: Temporal.Instant.from(licenseData.expiresAt),
          validatedAt: null,
        },
      });
    } catch (error) {
      // A registry row the organization never got would read as an active license, and the
      // retry would mint a second beside it (ADR-141).
      await this.peers.registry.delete(row.id);
      throw error;
    }

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      planType: licenseData.plan.type,
      licenseId: licenseData.licenseId,
      expiresAt: licenseData.expiresAt,
    };
  }
}
