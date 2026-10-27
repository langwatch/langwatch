import type {
  OrganizationLicensePair,
  OrganizationLicenseRepository,
} from "../repositories/organization-license.repository.ts";
import { isOrganizationNewer, sameLicense } from "../rules/license-columns.rules.ts";

type LicenseRows = Pick<OrganizationLicenseRepository, "findLicensePairs" | "overwriteLicenses">;

/**
 * A missing row is stale, and so is a differing one organization's columns were written after;
 * an organization with neither licence nor row is not.
 */
const isStale = ({ columns, columnsUpdatedAt, own, ownUpdatedAt }: OrganizationLicensePair) =>
  own === null
    ? columns.licenseKey !== null
    : !sameLicense({ a: own, b: columns }) &&
      isOrganizationNewer({
        organizationUpdatedAt: columnsUpdatedAt,
        licenseUpdatedAt: ownUpdatedAt,
      });

/** Where a run stopped and what it did; saved as the step's checkpoint after each batch. */
type OrganizationLicenseCopyReport = Readonly<{
  afterOrganizationId: string | null;
  copied: number;
  wouldCopy: number;
}>;

const DEFAULT_BATCH_SIZE = 500;

/**
 * Levels licensing's rows with organization's columns while dual-write lasts (round 37 D6, R42):
 * a missing row is copied, a differing one overwritten only where organization's are newer (Alex,
 * 2026-10-09), a write on either side since the read is kept, and a dry run writes nothing.
 */
export class OrganizationLicenseCopyService {
  static create(
    deps: Readonly<{ licenses: LicenseRows; batchSize?: number }>,
  ): OrganizationLicenseCopyService {
    return new OrganizationLicenseCopyService(deps.licenses, deps.batchSize ?? DEFAULT_BATCH_SIZE);
  }

  private constructor(
    private readonly licenses: LicenseRows,
    private readonly batchSize: number,
  ) {}

  async copyFromOrganizations({
    dryRun,
    signal,
    afterOrganizationId,
    onBatchDone,
  }: Readonly<{
    dryRun: boolean;
    signal: AbortSignal;
    afterOrganizationId: string | null;
    onBatchDone: (input: Readonly<{ report: OrganizationLicenseCopyReport }>) => Promise<void>;
  }>): Promise<OrganizationLicenseCopyReport> {
    let report: OrganizationLicenseCopyReport = { afterOrganizationId, copied: 0, wouldCopy: 0 };
    while (!signal.aborted) {
      const page = await this.licenses.findLicensePairs({
        afterOrganizationId: report.afterOrganizationId,
        limit: this.batchSize,
      });
      const last = page.at(-1);
      if (last === void 0) break;
      const stale = page.filter(isStale);
      if (dryRun) {
        report = {
          ...report,
          afterOrganizationId: last.organizationId,
          wouldCopy: report.wouldCopy + stale.length,
        };
        continue;
      }
      const copied =
        stale.length === 0 ? 0 : await this.licenses.overwriteLicenses({ pairs: stale });
      report = {
        ...report,
        afterOrganizationId: last.organizationId,
        copied: report.copied + copied,
      };
      await onBatchDone({ report });
    }
    return report;
  }
}
