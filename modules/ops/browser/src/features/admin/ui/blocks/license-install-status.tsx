import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { Copy, Server } from "lucide-react";
import type { ReactNode } from "react";

import {
  customerSyncMessage,
  formatDay,
  formatMoment,
  nextSyncText,
  type LicenseChainState,
} from "../../model/license-chain.ts";
import type { License } from "../../model/license-terms.ts";

/** The last sync line: when, which version, seats in use and when the next one is due. */
function syncDetail({ license, nowMs }: { license: License; nowMs: number }): string {
  if (license.lastSyncAt) {
    return [
      `Last sync ${formatMoment(license.lastSyncAt)}`,
      license.lastSyncVersion ?? "an unnamed version",
      `${license.reportedMembers ?? 0} of ${license.maxMembers} seats in use`,
      nextSyncText({ lastSyncAt: license.lastSyncAt, nowMs }),
    ].join(" · ");
  }
  if (license.instanceBoundAt)
    return `Bound ${formatMoment(license.instanceBoundAt)}, never synced`;
  return "Bound, never synced";
}

/** Which install holds the license and when it last synced, or that none has used it yet. */
export function LicenseInstallStatus({
  chain,
  nowMs,
}: {
  chain: LicenseChainState;
  nowMs: number;
}) {
  const { inUse } = chain;
  if (chain.unbound || !inUse.instanceId) {
    return (
      <StatusCard
        title="Not activated yet"
        detail="No install has used this license. It binds to the first install that does."
        muted
      />
    );
  }
  const detail = syncDetail({ license: inUse, nowMs });
  return (
    <StatusCard
      title={inUse.instanceId}
      badge={<Badge colorPalette="green">Bound</Badge>}
      detail={detail}
    />
  );
}

function StatusCard({
  title,
  badge,
  detail,
  muted = false,
}: {
  title: string;
  badge?: ReactNode;
  detail: string;
  muted?: boolean;
}) {
  return (
    <HStack
      gap={3}
      align="start"
      width="full"
      padding={3}
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border"
      bg={muted ? "bg.subtle" : "bg.panel"}
      data-testid="license-install-status"
    >
      <Box color="fg.muted" paddingTop={0.5}>
        <Server size={16} />
      </Box>
      <VStack align="start" gap={0.5} minWidth={0}>
        <HStack gap={2}>
          <Text fontWeight="semibold" fontSize="sm">
            {title}
          </Text>
          {badge}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {detail}
        </Text>
      </VStack>
    </HStack>
  );
}

/** A replacement on its way to the install, and how the customer can fetch it now. */
export function LicenseDeliveryBanner({
  chain,
  nowMs,
}: {
  chain: LicenseChainState;
  nowMs: number;
}) {
  const { pending, inUse } = chain;
  const { copy, copied } = useCopyToClipboard();
  if (!pending || chain.unbound || !inUse.instanceId) return null;
  const install = inUse.instanceId;
  const change = pendingChange(chain);
  const when = inUse.lastSyncAt
    ? `It arrives on the next daily sync, ${nextSyncText({ lastSyncAt: inUse.lastSyncAt, nowMs }).replace("next sync ", "")}.`
    : "It arrives on the install's next sync.";
  return (
    <Alert.Root status="warning" data-testid="license-delivery-banner">
      <Alert.Indicator />
      <Alert.Content gap={1}>
        <Alert.Title>{`${change.title} is waiting for ${install}`}</Alert.Title>
        <Alert.Description>
          {`${when} To get it now, ask the customer to press Refresh license on Settings, License.`}
        </Alert.Description>
      </Alert.Content>
      <Button
        size="xs"
        variant="outline"
        alignSelf="center"
        onClick={() => copy(customerSyncMessage({ change: change.message, install }))}
      >
        <Copy size={14} />
        {copied ? "Copied" : "Copy message"}
      </Button>
    </Alert.Root>
  );
}

/** What the waiting replacement changes, said for the banner and for the customer. */
export function pendingChange(chain: LicenseChainState): { title: string; message: string } {
  const { pending, inUse } = chain;
  if (!pending) return { title: "", message: "" };
  if (pending.maxMembers !== inUse.maxMembers) {
    return {
      title: `${pending.maxMembers} seats`,
      message: `changed your LangWatch license to ${pending.maxMembers} seats`,
    };
  }
  if (pending.expiresAt !== inUse.expiresAt) {
    return {
      title: `Extension to ${formatDay(pending.expiresAt)}`,
      message: `extended your LangWatch license to ${formatDay(pending.expiresAt)}`,
    };
  }
  return { title: "A new license", message: "updated your LangWatch license" };
}
