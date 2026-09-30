/**
 * Colleagues waiting at the door, where an administrator looks every day. Draws nothing for
 * anybody who cannot approve, and nothing while nobody waits.
 * Spec: specs/identity/domain-auto-join.feature
 */
import { Box, Button, Card, Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { ArrowRight, UserPlus } from "lucide-react";

import { useJoinRequests } from "../../behavior/use-join-requests.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { JoinRequestsTable } from "../blocks/join-requests-table.tsx";

export function PendingJoinRequests() {
  const host = useOrganizationHost();
  const organization = host.organization();
  const canManage = host.hasOrganizationPermission("organization:manage");
  const join = useJoinRequests({
    organizationId: organization?.id ?? "",
    canManage: canManage && !!organization,
  });

  if (!organization || !canManage || join.requests.length === 0) return null;

  return (
    <Box width="full" data-testid="home-pending-join-requests">
      <Card.Root
        bg="bg.surface/50"
        backdropBlur="md"
        borderWidth="1px"
        borderColor="border"
        borderRadius="14px"
        boxShadow="none"
      >
        <Card.Body padding={4} gap={3}>
          <HStack gap={2}>
            <Box color="fg.muted" display="flex" alignItems="center">
              <UserPlus size={16} aria-hidden />
            </Box>
            <Heading as="h3" size="sm">
              Waiting to join
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              {join.requests.length === 1
                ? "One person has asked to join your organization."
                : `${join.requests.length} people have asked to join your organization.`}
            </Text>
            <Spacer />
            <Link href="/settings/directory">
              <Button size="xs" variant="ghost" color="fg.muted">
                All requests
                <ArrowRight size={14} aria-hidden />
              </Button>
            </Link>
          </HStack>
          <JoinRequestsTable
            requests={join.requests}
            isAdmin
            answeringId={join.answeringId}
            onApprove={join.approve}
            onReject={join.reject}
          />
        </Card.Body>
      </Card.Root>
    </Box>
  );
}
