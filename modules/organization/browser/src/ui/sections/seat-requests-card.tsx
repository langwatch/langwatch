import { Link } from "@langwatch/browser-host/link";
/**
 * People waiting for a full seat, where administrators and Billing members look: the Directory's
 * People tab and the home screen. Draws nothing for a reader who cannot see seat requests, and
 * nothing while nobody waits. Spec: modules/organization/specs/seat-requests.feature
 */
import { Card } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ArrowRight, Armchair } from "lucide-react";

import { useSeatRequests } from "../../behavior/use-seat-requests.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { SeatRequestsTable } from "../blocks/seat-requests-table.tsx";

export function SeatRequestsCard({ showAllLink = false }: { showAllLink?: boolean }) {
  const host = useOrganizationHost();
  const organization = host.organization();
  const canView = host.hasOrganizationPermission("seatRequests:view");
  const seats = useSeatRequests({
    organizationId: organization?.id ?? "",
    canView: canView && !!organization,
    canManage: host.hasOrganizationPermission("seatRequests:manage"),
  });

  if (!organization || !canView || seats.requests.length === 0) return null;

  return (
    <Box width="full" data-testid="seat-requests-card">
      <Card bodyLayout="spaced">
        <VStack align="stretch" gap={3}>
          <HStack gap={2}>
            <Box color="fg.muted" display="flex" alignItems="center">
              <Armchair size={16} aria-hidden />
            </Box>
            <Heading as="h3" textStyle="cardTitle">
              Waiting for a seat
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              {seats.requests.length === 1
                ? "One person needs a full member seat."
                : `${seats.requests.length} people need a full member seat.`}
            </Text>
            <Spacer />
            {showAllLink && (
              <Link href="/settings/directory">
                <Button size="xs" variant="ghost" color="fg.muted">
                  Users
                  <ArrowRight size={14} aria-hidden />
                </Button>
              </Link>
            )}
          </HStack>
          <SeatRequestsTable
            requests={seats.requests}
            seatFree={seats.seatFree}
            approvalPath={seats.approvalPath}
            canManage={seats.canManage}
            answeringId={seats.answeringId}
            onApprove={seats.approve}
            onDecline={seats.decline}
          />
        </VStack>
      </Card>
    </Box>
  );
}
