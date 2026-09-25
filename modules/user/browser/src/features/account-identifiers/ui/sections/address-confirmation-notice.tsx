import { Text } from "@chakra-ui/react";

import { useAddressConfirmationLanding } from "../../behavior/use-address-confirmation-landing.ts";

/** What the emailed link did when it landed here, if it landed here. */
export function AddressConfirmationNotice({ onConfirmed }: { onConfirmed: () => Promise<void> }) {
  const outcome = useAddressConfirmationLanding({ onConfirmed });

  if (outcome === "confirmed") {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="address-confirmed-now">
        That address is confirmed. You can sign in with it, and we can reach you at it.
      </Text>
    );
  }

  if (outcome === "wrong-browser") {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="address-wrong-browser">
        Open the link in the window you added the address from. A link on its own confirms nothing,
        which is what stops a forwarded one working.
      </Text>
    );
  }

  return null;
}
