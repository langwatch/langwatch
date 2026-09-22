import { Box, Button, Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import { ArrowRight, UserPlus } from "lucide-react";
import { JoinRequestsTable } from "~/components/members/JoinRequestsTable";
import { useJoinRequests } from "~/components/members/useJoinRequests";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { HomeCard } from "./HomeCard";

/**
 * Colleagues waiting at the door, where an administrator actually looks.
 *
 * A join request lives or dies on being noticed: it expires, and the person
 * behind it is sitting in a "waiting for approval" screen. The members page
 * shows the same list, but an administrator opens the members page when they
 * are thinking about members — the home page is where they are every day, so
 * the wait is surfaced here and answerable here, approve and decline both.
 *
 * Renders nothing at all for everybody else: no empty card, no permission
 * chatter. A panel about approvals has no business on the screen of somebody
 * who cannot approve.
 */
export function PendingJoinRequests() {
  const { organization, hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const canManage = hasPermission("organization:manage");
  const join = useJoinRequests({
    organizationId: organization?.id ?? "",
    canManage: canManage && !!organization,
  });

  if (!organization || !canManage || join.requests.length === 0) return null;

  return (
    <Box width="full" data-testid="home-pending-join-requests">
      <HomeCard>
        <Box padding={4}>
          <HStack gap={2} marginBottom={3}>
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
            <Link href="/settings/members?tab=requests">
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
        </Box>
      </HomeCard>
    </Box>
  );
}
