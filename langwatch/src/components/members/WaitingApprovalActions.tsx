import { Button, HStack, Text } from "@chakra-ui/react";
import { LuCheck, LuX } from "react-icons/lu";

interface WaitingApprovalActionsProps {
  isAdmin: boolean;
  inviteId: string;
  onApprove: (inviteId: string) => void;
  onReject: (inviteId: string) => void;
}

/**
 * Renders action buttons for WAITING_APPROVAL invites.
 * Admins see Approve/Reject buttons; non-admins see a status message.
 */
export function WaitingApprovalActions({
  isAdmin,
  inviteId,
  onApprove,
  onReject,
}: WaitingApprovalActionsProps) {
  if (!isAdmin) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Waiting for admin approval
      </Text>
    );
  }

  return (
    <HStack gap={2}>
      <Button
        size="sm"
        colorPalette="green"
        variant="outline"
        onClick={() => onApprove(inviteId)}
        aria-label="Approve"
      >
        <LuCheck size={14} />
        Approve
      </Button>
      <Button
        size="sm"
        colorPalette="red"
        variant="outline"
        onClick={() => onReject(inviteId)}
        aria-label="Reject"
      >
        <LuX size={14} />
        Reject
      </Button>
    </HStack>
  );
}
