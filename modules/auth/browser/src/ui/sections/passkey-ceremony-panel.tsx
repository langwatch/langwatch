import { Box, Button, Text, VStack } from "@langwatch/design-system/primitives";
import { Fingerprint } from "lucide-react";

import {
  cancelPasskeyCeremony,
  type PasskeyCeremonyState,
  retryPasskeyCeremony,
} from "../../behavior/passkey-ceremony.store.ts";
import { SHAPE } from "../../model/front-door-theme.ts";
import { FrontDoorPrimaryButton } from "../elements/front-door-primary-button.tsx";

import "../elements/auth-front-door.css";

/** The heading for the state; the surrounding card renders it, so a card has one heading. */
export function passkeyCeremonyTitle({ ceremony }: { ceremony: PasskeyCeremonyState }): string {
  return ceremony.status === "unanswered"
    ? "We didn't hear back from your device"
    : "Use your passkey";
}

/**
 * The card while a passkey ceremony is in flight: a wait for a device, not a spinner. Both ways
 * out land on the methods with nothing reported as failed; the glyph breathes only where motion
 * is welcome (auth-front-door.css).
 */
export function PasskeyCeremonyPanel({ ceremony }: { ceremony: PasskeyCeremonyState }) {
  const unanswered = ceremony.status === "unanswered";

  return (
    <VStack
      width="full"
      align="stretch"
      gap="4"
      data-testid="passkey-ceremony"
      data-status={ceremony.status}
    >
      <VStack gap="3.5" paddingTop="1.5">
        <Box
          className="lw-front-door-passkey-glyph"
          data-testid="passkey-ceremony-glyph"
          display="flex"
          alignItems="center"
          justifyContent="center"
          width="56px"
          height="56px"
          borderRadius="full"
          color="frontDoor.ink"
          backgroundColor="frontDoor.tint"
        >
          <Fingerprint size={26} aria-hidden="true" />
        </Box>
        <Text
          textStyle="bodySm"
          color="fg.muted"
          textAlign="center"
          maxWidth="34ch"
          css={{ textWrap: "balance" }}
          data-testid="passkey-ceremony-explainer"
        >
          {unanswered
            ? "Nothing was sent and nothing changed. Try again, or carry on another way."
            : "Your browser or device is asking you to confirm it now. The prompt can also open on another device, such as your phone."}
        </Text>
      </VStack>

      <VStack width="full" align="stretch" gap="9px">
        {unanswered ? (
          <FrontDoorPrimaryButton onClick={retryPasskeyCeremony} testId="passkey-ceremony-retry">
            Try again
          </FrontDoorPrimaryButton>
        ) : null}
        <Button
          textStyle="body"
          variant="outline"
          width="full"
          minHeight="44px"
          borderRadius={SHAPE.control}
          borderColor="frontDoor.fieldBorder"
          onClick={cancelPasskeyCeremony}
          data-testid="passkey-ceremony-cancel"
        >
          Cancel
        </Button>
        <Button
          textStyle="bodySm"
          variant="plain"
          size="sm"
          alignSelf="center"
          textDecoration="underline"
          textUnderlineOffset="3px"
          onClick={cancelPasskeyCeremony}
          data-testid="passkey-ceremony-other-methods"
        >
          Use a different method
        </Button>
      </VStack>
    </VStack>
  );
}
