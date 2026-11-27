import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { formatDay, type LicenseChainState } from "../../model/license-chain.ts";
import type { License } from "../../model/license-terms.ts";
import { LicenseStatusBadge } from "../elements/license-status-badge.tsx";

function roleOf({ chain, license }: { chain: LicenseChainState; license: License }) {
  if (chain.pending?.id === license.id)
    return <Badge colorPalette="orange">waiting for sync</Badge>;
  if (chain.inUse.id === license.id && license.status === "active" && license.instanceId) {
    return <Badge colorPalette="green">in use</Badge>;
  }
  return <LicenseStatusBadge status={license.status} />;
}

/** Every license signed for this customer in one chain, the newest first, kept for audit. */
export function LicenseHistory({ chain }: { chain: LicenseChainState }) {
  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderRadius="md"
      bg="bg.subtle"
      data-testid="license-history"
    >
      <Text fontWeight="medium" fontSize="sm">
        {`License history, ${chain.licenses.length} signed`}
      </Text>
      {chain.licenses.map((license) => (
        <HStack key={license.id} gap={3} fontSize="sm" justify="space-between">
          <VStack align="start" gap={0}>
            <Text>{`Ends ${formatDay(license.expiresAt)} · ${license.maxMembers} full seats`}</Text>
            <Text fontSize="xs" color="fg.muted">
              {`Signed ${formatDay(license.issuedAt)} · ${license.licenseId}`}
            </Text>
          </VStack>
          {roleOf({ chain, license })}
        </HStack>
      ))}
    </VStack>
  );
}
