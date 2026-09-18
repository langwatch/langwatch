import { Button, Text, VStack } from "@chakra-ui/react";

import { AuthCard } from "./auth-card.tsx";

/** Verification link confirmation screen; includes back option for wrong address. */
export function CheckYourEmail({
  email,
  what,
  onUseDifferentEmail,
}: {
  email: string;
  /** What the link does when they open it, in their words. */
  what: string;
  /** Back to the address step, for the address that was typed wrong. */
  onUseDifferentEmail?: () => void;
}) {
  return (
    <AuthCard title="Check your email">
      <VStack width="full" align="stretch" gap="14px">
        {/* Centred under a centred title, because there is nothing to do on
            this card. Every other screen left-aligns its words against a form
            the eye has to return to; here the sentence IS the screen, so it
            sits on the same axis as the heading over it. */}
        <Text
          data-testid="verification-sent"
          textAlign="center"
          textWrap="balance"
          lineHeight="1.65"
        >
          We sent a link to <b>{email}</b>. {what} The link expires in 1 hour.
        </Text>
        {onUseDifferentEmail ? (
          <Button
            variant="plain"
            size="sm"
            alignSelf="center"
            fontSize="13px"
            textDecoration="underline"
            textUnderlineOffset="3px"
            onClick={onUseDifferentEmail}
            data-testid="check-email-back"
          >
            Wrong address? Use a different email
          </Button>
        ) : null}
      </VStack>
    </AuthCard>
  );
}
