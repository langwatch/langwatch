import { HStack, IconButton } from "@chakra-ui/react";
import { Check, X } from "lucide-react";

interface WaitingApprovalActionsProps {
  isAdmin: boolean;
  inviteId: string;
  onApprove: (inviteId: string) => void;
  onReject: (inviteId: string) => void;
}

/**
 * Renders action buttons for WAITING_APPROVAL invites.
 * Admins see Approve/Reject buttons; non-admins see no actions.
 */
export function WaitingApprovalActions({
  isAdmin,
  inviteId,
  onApprove,
  onReject,
}: WaitingApprovalActionsProps) {
  if (!isAdmin) {
    return null;
  }

  return (
    <HStack gap={2}>
      <IconButton
        aria-label="Approve"
        variant="ghost"
        size="sm"
        color="green.500"
        onClick={() => onApprove(inviteId)}
      >
        <Check size={16} />
      </IconButton>
      <IconButton
        aria-label="Reject"
        variant="ghost"
        size="sm"
        color="red.500"
        onClick={() => onReject(inviteId)}
      >
        <X size={16} />
      </IconButton>
    </HStack>
  );
}
