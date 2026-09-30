import { SimpleGrid } from "@chakra-ui/react";
import { EmptyCell, formatDate, formatDateTime } from "../../BackofficeTable";
import { Detail } from "./DrawerSection";
import { StatusBadge } from "./StatusBadge";
import type { License } from "./types";

export function LicenseDetails({ license }: { license: License }) {
  return (
    <SimpleGrid columns={2} gap={3} width="full" fontSize="sm">
      <Detail label="Status">
        <StatusBadge status={license.status} />
      </Detail>
      <Detail label="License id">{license.licenseId}</Detail>
      <Detail label="Plan">{license.planType}</Detail>
      <Detail label="Seats">
        {license.maxMembers} full, {license.maxMembersLite} lite
      </Detail>
      <Detail label="Issued">{formatDate(license.issuedAt)}</Detail>
      <Detail label="Term ends">{formatDate(license.expiresAt)}</Detail>
      <Detail label="Source">{license.source}</Detail>
      <Detail label="Email">{license.email}</Detail>
      <Detail label="Instance">
        {license.instanceId
          ? `${license.instanceId} since ${formatDateTime(license.instanceBoundAt)}`
          : "not bound yet"}
      </Detail>
      <Detail label="Replaces">
        {license.replacesId ?? <EmptyCell>none</EmptyCell>}
      </Detail>
      <Detail label="Last sync">
        {license.lastSyncAt ? (
          `${formatDateTime(license.lastSyncAt)} from ${license.lastSyncVersion ?? "an unnamed version"}`
        ) : (
          <EmptyCell>never synced</EmptyCell>
        )}
      </Detail>
      <Detail label="Seats reported">
        {license.lastSyncAt ? (
          `${license.reportedMembers ?? 0} full, ${license.reportedMembersLite ?? 0} lite`
        ) : (
          <EmptyCell>none</EmptyCell>
        )}
      </Detail>
      {license.revokedAt ? (
        <Detail label="Revoked">
          {formatDateTime(license.revokedAt)}: {license.revokedReason}
        </Detail>
      ) : null}
      {license.hasPendingDelivery ? (
        <Detail label="Delivery">
          Reissued license waiting for the install to sync
        </Detail>
      ) : null}
    </SimpleGrid>
  );
}
