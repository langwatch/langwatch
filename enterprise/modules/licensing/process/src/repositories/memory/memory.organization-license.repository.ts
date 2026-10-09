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
 * The columns are read live from the map given, so a test can write them.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static create(
    licenses: ReadonlyMap<string, string | null | OrganizationLicenseColumns> = new Map(),
  ): MemoryOrganizationLicenseRepository {
    return new MemoryOrganizationLicenseRepository(licenses);
  }

  private readonly own = new Map<string, LicenseColumns>();

  private constructor(
    private readonly organizations: ReadonlyMap<string, string | null | OrganizationLicenseColumns>,
  ) {}

  private columnsOf(organizationId: string): LicenseColumns | undefined {
    return this.organizations.has(organizationId)
      ? rowOf(this.organizations.get(organizationId) ?? null)
      : void 0;
  }

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const row = this.own.get(organizationId) ?? this.columnsOf(organizationId);
    if (row === void 0) throw new OrganizationNotFoundError();
    return { licenseKey: row.licenseKey };
  }

  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const ids = new Set([...this.organizations.keys(), ...this.own.keys()]);
    return [...ids].flatMap((organizationId) => {
      const row = this.own.get(organizationId) ?? this.columnsOf(organizationId);
      return row === void 0 || row.licenseKey === null
        ? []
        : [{ organizationId, licenseKey: row.licenseKey }];
    });
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async findLicense({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<LicenseColumns[]> {
    const row = this.own.get(organizationId);
    return row === void 0 ? [] : [row];
  }

  async restoreLicense({
    organizationId,
    written,
    previous,
  }: Readonly<{
    organizationId: string;
    written: LicenseColumns;
    previous: LicenseColumns | null;
  }>): Promise<void> {
    const held = this.own.get(organizationId);
    if (held === void 0 || !sameLicense({ a: held, b: written })) return;
    if (previous === null) this.own.delete(organizationId);
    else this.own.set(organizationId, previous);
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
        columns: rowOf(columns),
        own: this.own.get(organizationId) ?? null,
      }));
  }

  async overwriteLicenses({
    pairs,
  }: Readonly<{ pairs: readonly OrganizationLicensePair[] }>): Promise<number> {
    const current = pairs.filter(({ organizationId, columns, own }) => {
      const held = this.own.get(organizationId);
      const source = this.columnsOf(organizationId);
      if (held === void 0 || own === null) return held === void 0 && own === null;
      return (
        source !== void 0 &&
        sameLicense({ a: source, b: columns }) &&
        sameLicense({ a: held, b: own })
      );
    });
    for (const { organizationId, columns } of current) this.own.set(organizationId, columns);
    return current.length;
  }
}
