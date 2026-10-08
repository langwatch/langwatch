import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import { sameLicense } from "../../rules/license-columns.rules.ts";
import type {
  LicenseColumns,
  OrganizationLicenseCandidate,
  OrganizationLicensePair,
  OrganizationLicenseRepository,
  StoredLicense,
} from "../organization-license.repository.ts";

/** Organization's licence columns as the copy step finds them; dates default to none. */
export type OrganizationLicenseColumns = Readonly<{
  licenseKey: string | null;
  expiresAt?: Instant | null;
  validatedAt?: Instant | null;
}>;

const rowOf = (columns: string | null | OrganizationLicenseColumns): LicenseColumns =>
  columns === null || typeof columns === "string"
    ? { licenseKey: columns, expiresAt: null, validatedAt: null }
    : {
        licenseKey: columns.licenseKey,
        expiresAt: columns.expiresAt ?? null,
        validatedAt: columns.validatedAt ?? null,
      };

/**
 * Licensing's rows beside organization's columns, both in memory: an
 * organization in `organizations` exists, and its own row, once written, wins.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static create(
    licenses: ReadonlyMap<string, string | null | OrganizationLicenseColumns> = new Map(),
  ): MemoryOrganizationLicenseRepository {
    return new MemoryOrganizationLicenseRepository(
      new Map([...licenses].map(([organizationId, columns]) => [organizationId, rowOf(columns)])),
    );
  }

  private readonly own = new Map<string, LicenseColumns>();

  private constructor(private readonly organizations: ReadonlyMap<string, LicenseColumns>) {}

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const row = this.own.get(organizationId) ?? this.organizations.get(organizationId);
    if (row === void 0) throw new OrganizationNotFoundError();
    return { licenseKey: row.licenseKey };
  }

  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const merged = new Map([...this.organizations, ...this.own]);
    return [...merged].flatMap(([organizationId, row]) =>
      row.licenseKey === null ? [] : [{ organizationId, licenseKey: row.licenseKey }],
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async saveLicense({
    organizationId,
    license,
  }: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void> {
    this.own.set(organizationId, { ...license });
  }

  async clearLicense({ organizationId }: Readonly<{ organizationId: string }>): Promise<void> {
    this.own.set(organizationId, { licenseKey: null, expiresAt: null, validatedAt: null });
  }

  async findLicensePairs({
    afterOrganizationId,
    limit,
  }: Readonly<{ afterOrganizationId: string | null; limit: number }>): Promise<
    OrganizationLicensePair[]
  > {
    return [...this.organizations]
      .filter(
        ([organizationId]) => afterOrganizationId === null || organizationId > afterOrganizationId,
      )
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, limit)
      .map(([organizationId, columns]) => ({
        organizationId,
        columns,
        own: this.own.get(organizationId) ?? null,
      }));
  }

  async overwriteLicenses({
    pairs,
  }: Readonly<{ pairs: readonly OrganizationLicensePair[] }>): Promise<number> {
    const current = pairs.filter(({ organizationId, own }) => {
      const held = this.own.get(organizationId);
      return held === void 0 || own === null
        ? held === void 0 && own === null
        : sameLicense({ a: held, b: own });
    });
    for (const { organizationId, columns } of current) this.own.set(organizationId, columns);
    return current.length;
  }
}
