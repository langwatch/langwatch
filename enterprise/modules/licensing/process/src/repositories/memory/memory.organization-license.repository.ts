import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import { isOrganizationNewer, sameLicense } from "../../rules/license-columns.rules.ts";
import type {
  LicenseColumns,
  OrganizationLicenseCandidate,
  OrganizationLicensePair,
  OrganizationLicenseRepository,
  StoredLicense,
} from "../organization-license.repository.ts";

/**
 * Organization's licence columns as the copy step finds them; dates default to none,
 * and a missing `updatedAt` predates every row licensing writes.
 */
export type OrganizationLicenseColumns = Readonly<{
  licenseKey: string | null;
  expiresAt?: Instant | null;
  validatedAt?: Instant | null;
  updatedAt?: Instant;
}>;

type Columns = string | null | OrganizationLicenseColumns;
type OwnRow = Readonly<{ license: LicenseColumns; updatedAt: Instant }>;

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

const updatedAtOf = (columns: Columns): Instant =>
  columns === null || typeof columns === "string" ? EPOCH : (columns.updatedAt ?? EPOCH);

const rowOf = (columns: Columns): LicenseColumns =>
  columns === null || typeof columns === "string"
    ? { licenseKey: columns, expiresAt: null, validatedAt: null }
    : {
        licenseKey: columns.licenseKey,
        expiresAt: columns.expiresAt ?? null,
        validatedAt: columns.validatedAt ?? null,
      };

/**
 * Licensing's rows beside organization's columns, both in memory: an
 * organization in `organizations` exists, and its own row wins unless the columns
 * are newer. The columns are read live from the map given, so a test can write them.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static create(
    licenses: ReadonlyMap<string, Columns> = new Map(),
  ): MemoryOrganizationLicenseRepository {
    return new MemoryOrganizationLicenseRepository(licenses);
  }

  private readonly own = new Map<string, OwnRow>();

  private constructor(private readonly organizations: ReadonlyMap<string, Columns>) {}

  private columnsOf(organizationId: string): LicenseColumns | undefined {
    return this.organizations.has(organizationId)
      ? rowOf(this.organizations.get(organizationId) ?? null)
      : void 0;
  }

  /** The licence read: organization's columns where they are newer than the row, else the row. */
  private licenseOf(organizationId: string): LicenseColumns | undefined {
    const row = this.own.get(organizationId);
    const columns = this.columnsOf(organizationId);
    if (columns === void 0) return row?.license;
    const newer = isOrganizationNewer({
      organizationUpdatedAt: updatedAtOf(this.organizations.get(organizationId) ?? null),
      licenseUpdatedAt: row?.updatedAt ?? null,
    });
    return newer || row === void 0 ? columns : row.license;
  }

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const license = this.licenseOf(organizationId);
    if (license === void 0) throw new OrganizationNotFoundError();
    return { licenseKey: license.licenseKey };
  }

  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const ids = new Set([...this.organizations.keys(), ...this.own.keys()]);
    return [...ids].flatMap((organizationId) => {
      const licenseKey = this.licenseOf(organizationId)?.licenseKey ?? null;
      return licenseKey === null ? [] : [{ organizationId, licenseKey }];
    });
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async findLicense({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<LicenseColumns[]> {
    const row = this.own.get(organizationId);
    return row === void 0 ? [] : [row.license];
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
    if (held === void 0 || !sameLicense({ a: held.license, b: written })) return;
    if (previous === null) this.own.delete(organizationId);
    else this.own.set(organizationId, { license: previous, updatedAt: nowInstant() });
  }

  async saveLicense({
    organizationId,
    license,
  }: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void> {
    this.own.set(organizationId, { license: { ...license }, updatedAt: nowInstant() });
  }

  async clearLicense({ organizationId }: Readonly<{ organizationId: string }>): Promise<void> {
    this.own.set(organizationId, {
      license: { licenseKey: null, expiresAt: null, validatedAt: null },
      updatedAt: nowInstant(),
    });
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
      .map(([organizationId, columns]) => {
        const row = this.own.get(organizationId);
        return {
          organizationId,
          columns: rowOf(columns),
          columnsUpdatedAt: updatedAtOf(columns),
          own: row?.license ?? null,
          ownUpdatedAt: row?.updatedAt ?? null,
        };
      });
  }

  async overwriteLicenses({
    pairs,
  }: Readonly<{ pairs: readonly OrganizationLicensePair[] }>): Promise<number> {
    const current = pairs.filter(({ organizationId, columns, own, ownUpdatedAt }) => {
      const held = this.own.get(organizationId);
      const source = this.columnsOf(organizationId);
      if (held === void 0 || own === null) return held === void 0 && own === null;
      return (
        source !== void 0 &&
        sameLicense({ a: source, b: columns }) &&
        sameLicense({ a: held.license, b: own }) &&
        ownUpdatedAt !== null &&
        held.updatedAt.equals(ownUpdatedAt)
      );
    });
    for (const { organizationId, columns } of current) {
      this.own.set(organizationId, { license: columns, updatedAt: nowInstant() });
    }
    return current.length;
  }
}
