import { Button, Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "~/components/auth/AuthCard";
import { inboxUrlFor } from "../logic/inboxProviders";
import { AuthSecondaryButton } from "./AuthSecondaryButton";

/**
 * The one state both doors end at when an address has to be confirmed: the
 * link is out, and there is nothing to do here until it comes back.
 *
 * Sign-up and a log-in that turned out to be a sign-up render the same card
 * with the same shape, because to the person waiting they are the same thing.
 *
 * It is not a dead end. The commonest reason to be looking at this card
 * puzzled is that the address on it is wrong — a typo, or the wrong one of two
 * — and the only way out used to be the browser's back button, which lands on
 * a step this screen keeps in memory rather than in the URL. So the way back
 * is on the card: it returns to the address step with nothing sent that
 * matters, because an unopened link simply expires.
 */
export function CheckYourEmail({
  email,
  what,
  uncertain = false,
  onUseDifferentEmail,
}: {
  email: string;
  /** What the link does when they open it, in their words. */
  what: string;
  /**
   * Whether a link was actually sent is not ours to say.
   *
   * Password reset answers identically for an address with an account and one
   * without (`specs/auth/password-reset.feature`), so its card must not open
   * with "We sent a link" — that sentence IS the oracle the endpoint spent its
   * design avoiding. Everywhere else the address is one we already know about,
   * and hedging there would read as a system unsure whether it had done the
   * thing it just did.
   */
  uncertain?: boolean;
  /** Back to the address step, for the address that was typed wrong. */
  onUseDifferentEmail?: () => void;
}) {
  const inboxUrl = inboxUrlFor({ email });

  return (
    // Solid rather than glass: this card is one sentence with nothing to
    // operate, and the glass treatment left the words washed against the
    // ground it was asking somebody to leave.
    <AuthCard title="Check your email" solid>
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
          {uncertain ? (
            <>
              If an account exists for <b>{email}</b>, we have sent a link.
            </>
          ) : (
            <>
              We sent a link to <b>{email}</b>.
            </>
          )}{" "}
          {what} The link expires in 1 hour.
        </Text>
        {/* Only for the mailboxes everyone recognizes: a company domain gets
            no guess, because a wrong guess is a login page for a mailbox the
            person does not have. */}
        {inboxUrl ? (
          <AuthSecondaryButton href={inboxUrl} testId="go-to-inbox">
            Go to inbox
          </AuthSecondaryButton>
        ) : null}
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
