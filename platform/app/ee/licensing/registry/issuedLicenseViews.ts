/**
 * How a registry row reads once it leaves the service: the derived status and
 * allowance, the held license dropped, and for a browsing caller the seats the
 * install reported in the term quarter now running (ADR-141).
 */

import {
  defaultSeatOverageAllowance,
  type IssuedLicenseBrowseView,
  type IssuedLicenseRecord,
  type IssuedLicenseView,
  statusOfIssuedLicense,
} from "./issuedLicense";
import {
  type LicenseSeatReportRepository,
  seatQuarterKeyFor,
} from "./seatReports";

export function issuedLicenseView({
  row,
  now,
}: {
  row: IssuedLicenseRecord;
  now: Date;
}): IssuedLicenseView {
  const { pendingDeliveryLicense, ...stored } = row;
  return {
    ...stored,
    status: statusOfIssuedLicense(row, now),
    effectiveSeatOverageAllowance:
      row.seatOverageAllowance ?? defaultSeatOverageAllowance(row.maxMembers),
    hasPendingDelivery: pendingDeliveryLicense !== null,
  };
}

/** The rows with the seats each reported in the quarter now running. */
export async function browseIssuedLicenses({
  rows,
  seatReports,
  now,
}: {
  rows: IssuedLicenseRecord[];
  seatReports: LicenseSeatReportRepository;
  now: Date;
}): Promise<IssuedLicenseBrowseView[]> {
  const keys = rows.map((row) =>
    seatQuarterKeyFor({ licenseId: row.id, issuedAt: row.issuedAt, now }),
  );
  const reports = await seatReports.findByQuarters(keys);
  const byLicense = new Map(
    reports.map((report) => [report.licenseId, report]),
  );
  return rows.map((row) => {
    const report = byLicense.get(row.id);
    return {
      ...issuedLicenseView({ row, now }),
      currentQuarterSeats: report
        ? {
            quarterStartsAt: report.quarterStartsAt,
            peakMembers: report.peakMembers,
            peakMembersLite: report.peakMembersLite,
          }
        : null,
    };
  });
}
