/**
 * The offer to add an address. Adding one starts with a mailed link, so where
 * the installation cannot send email the offer stands down and its tooltip says
 * what is missing, like a stood-down Remove does.
 */
import { Box, Button } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Plus } from "lucide-react";

export const ADD_ADDRESS_NEEDS_EMAIL_COPY =
  "Adding an address sends it a confirmation link, and this installation cannot send email yet. Ask an administrator to set up an email provider.";

export function AddAddressButton({
  canSendEmail,
  isOpen,
  onToggle,
}: {
  canSendEmail: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  if (!canSendEmail) {
    return (
      <Tooltip content={ADD_ADDRESS_NEEDS_EMAIL_COPY} showArrow>
        {/* A disabled button receives no pointer events, so the wrapper is the
            tooltip's trigger. */}
        <Box data-testid="add-address-unavailable">
          <Button
            size="sm"
            variant="outline"
            disabled
            aria-label={`Add email address. ${ADD_ADDRESS_NEEDS_EMAIL_COPY}`}
            data-testid="add-address"
          >
            <Plus size={14} />
            Add email address
          </Button>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      aria-expanded={isOpen}
      onClick={onToggle}
      data-testid="add-address"
    >
      <Plus size={14} />
      Add email address
    </Button>
  );
}
