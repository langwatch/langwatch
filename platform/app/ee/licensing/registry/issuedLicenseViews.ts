/**
 * How a registry row reads once it leaves the service: the derived status, and
 * the held license dropped (ADR-141).
 */

import {
  type IssuedLicenseRecord,
  type IssuedLicenseView,
  statusOfIssuedLicense,
} from "./issuedLicense";

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
    hasPendingDelivery: pendingDeliveryLicense !== null,
  };
}
