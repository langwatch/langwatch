import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Fingerprint } from "lucide-react";
import "../auth.css";
import { SHAPE } from "../authTheme";
import {
  cancelPasskeyCeremony,
  ceremonyOffersOtherMethods,
  leavePasskeyCeremonyForOtherMethods,
  type PasskeyCeremonyState,
  retryPasskeyCeremony,
} from "../logic/passkeyCeremony";

/**
 * What the card becomes while a passkey ceremony is in flight.
 *
 * Not a spinner on the button that started it. A spinner says "we are
 * working", and we are not: the browser and the operating system have the
 * screen, the prompt may have opened on a phone in another room, and the
 * honest thing to draw is a state about WAITING for a device rather than a
 * control that looks briefly busy. It is the pattern the platforms
 * themselves use for this exact moment, and the reason is the same everywhere
 * — the wait can be long, and a rail of other methods sitting under a
 * spinning button invites somebody to click one and start a second ceremony
 * on top of the first.
 *
 * Three things are always on it:
 *
 *   - whose prompt it is. "Your browser or device is asking" is the one fact
 *     that turns a hang into a wait, because it says where to look.
 *   - a way out. Cancelling a ceremony is an ordinary decision, not a
 *     failure, and nothing here calls it one.
 *   - the other ways in, where the screen has any. A passkey that will not
 *     answer must never be a door somebody is stuck behind.
 *
 * The glyph breathes, slowly, and the breath is declared only inside a
 * `prefers-reduced-motion: no-preference` block — so for somebody who asked
 * for less motion the mark is simply THERE, still, with every word of the
 * panel intact. Opting in rather than switching off is the rule this
 * stylesheet states at the top: an animation that starts and then stops is
 * worse than one that never existed.
 */
/**
 * The heading for the state, which the SURROUNDING surface renders rather
 * than the panel.
 *
 * Every auth-screen state puts its own words in the card's one heading —
 * "Check your email" replaces "Log in to LangWatch" rather than sitting under
 * it — and a panel that carried its own title would put two headings on one
 * card. The settings dialog reads the same function for its title, so the two
 * surfaces cannot drift.
 */
export function passkeyCeremonyTitle(ceremony: PasskeyCeremonyState): string {
  return ceremony.status === "unanswered"
    ? "We didn't hear back from your device"
    : "Use your passkey";
}

export function PasskeyCeremonyPanel({
  ceremony,
}: {
  ceremony: PasskeyCeremonyState;
}) {
  const unanswered = ceremony.status === "unanswered";

  return (
    <VStack
      width="full"
      align="stretch"
      gap="16px"
      data-testid="passkey-ceremony"
      data-status={ceremony.status}
    >
      <VStack gap="14px" paddingTop="6px">
        <Box
          className="lw-auth-passkey-glyph"
          data-testid="passkey-ceremony-glyph"
          display="flex"
          alignItems="center"
          justifyContent="center"
          width="56px"
          height="56px"
          borderRadius="full"
          color="auth.ink"
          backgroundColor="auth.tint"
        >
          <Fingerprint size={26} aria-hidden="true" />
        </Box>
        <Text
          fontSize="13.5px"
          lineHeight="1.6"
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
          <Button
            className="lw-auth-primary"
            width="full"
            minHeight="44px"
            fontSize="14px"
            fontWeight={600}
            borderRadius={SHAPE.control}
            backgroundColor="auth.action"
            color="auth.onAction"
            _hover={{ backgroundColor: "auth.actionHover" }}
            onClick={retryPasskeyCeremony}
            data-testid="passkey-ceremony-retry"
          >
            Try again
          </Button>
        ) : null}
        {/* Always here, in both states. A waiting panel with no way out is a
            trap, and an unanswered one with only "try again" is the same trap
            wearing a suggestion. */}
        <Button
          variant="outline"
          width="full"
          minHeight="44px"
          fontSize="14px"
          borderRadius={SHAPE.control}
          borderColor="auth.fieldBorder"
          onClick={cancelPasskeyCeremony}
          data-testid="passkey-ceremony-cancel"
        >
          Cancel
        </Button>
        {ceremonyOffersOtherMethods(ceremony) ? (
          <Button
            variant="plain"
            size="sm"
            alignSelf="center"
            fontSize="13px"
            textDecoration="underline"
            textUnderlineOffset="3px"
            onClick={leavePasskeyCeremonyForOtherMethods}
            data-testid="passkey-ceremony-other-methods"
          >
            Use a different method
          </Button>
        ) : null}
      </VStack>
    </VStack>
  );
}
