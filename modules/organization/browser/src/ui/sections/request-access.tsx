/**
 * Request access, lent to every refusal a full seat would lift. Draws nothing unless the reader
 * holds a Lite Member seat here. Spec: modules/organization/specs/seat-requests.feature
 */
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import type { RequestAccessProps } from "@langwatch/organization-client";

import OrganizationHostMount from "../../behavior/organization-host-mount.tsx";
import { useAccessRequest } from "../../behavior/use-access-request.ts";
import { fullSeatLifts } from "../../model/full-seat-lifts.ts";
import { useHasOrganizationHost } from "../../model/organization-host.ts";

/**
 * Lenders draw this anywhere, licensing's restriction modal among them, which sits outside
 * organization's host mount: without a host above, it mounts its own.
 */
export default function RequestAccessAction(props: RequestAccessProps) {
  const hasHost = useHasOrganizationHost();
  if (!fullSeatLifts(props.permission)) return null;
  if (hasHost) return <RequestAccessButton {...props} />;
  return (
    <OrganizationHostMount>
      <RequestAccessButton {...props} />
    </OrganizationHostMount>
  );
}

function RequestAccessButton({ reason }: RequestAccessProps) {
  const access = useAccessRequest({ reason });
  if (!access.offered) return null;

  if (access.status === "approved") {
    return (
      <VStack align="start" gap={1} data-testid="request-access">
        <Text fontSize="sm">Your full seat was approved.</Text>
        <Button size="sm" colorPalette="orange" onClick={access.reload}>
          Reload
        </Button>
      </VStack>
    );
  }
  if (access.status === "open") {
    return (
      <VStack align="start" gap={1} data-testid="request-access">
        <Button size="sm" colorPalette="orange" disabled>
          Access requested
        </Button>
        <Text fontSize="sm" color="fg.muted">
          Your organization&apos;s admins were told. You&apos;ll get an email when they answer.
        </Text>
      </VStack>
    );
  }
  const declined = access.status === "declined";
  return (
    <VStack align="start" gap={1} data-testid="request-access">
      {declined ? (
        <Text fontSize="sm" color="fg.muted">
          An admin declined your request.
        </Text>
      ) : null}
      <Button
        size="sm"
        colorPalette="orange"
        loading={access.isSending || access.isLoading}
        onClick={() => void access.send()}
      >
        {declined ? "Ask again" : "Request access"}
      </Button>
    </VStack>
  );
}
