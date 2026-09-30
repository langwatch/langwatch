import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { FaMicrosoft, FaYahoo } from "react-icons/fa6";
import { SiGmail, SiIcloud, SiProtonmail } from "react-icons/si";
import { AuthCard } from "~/components/auth/AuthCard";
import {
  type InboxProviderId,
  inboxProviderFor,
} from "../logic/inboxProviders";
import { AuthSecondaryButton } from "./AuthSecondaryButton";

/**
 * The mark on the inbox door, one per mailbox we can open.
 *
 * Drawn as elements rather than component references for the same reason
 * `SignInMethodIcon` does it: the two icon sets type their props differently,
 * and a map of ready-made nodes is the one shape both fit without either
 * being widened to `any`.
 *
 * Monochrome, and left to inherit the button's own colour. This door is an
 * {@link AuthSecondaryButton} — the card's deliberately unfilled second way
 * on — and dropping a full-colour logo into it would paint the quietest
 * control on the card the loudest thing on it. It also means the marks need
 * no separate dark-mode cut.
 *
 * AOL gets the plain envelope: Simple Icons dropped the mark and Font
 * Awesome never carried one, and drawing some other company's logo beside
 * somebody's AOL address would be worse than drawing none.
 */
const INBOX_MARKS: Record<InboxProviderId, ReactNode> = {
  gmail: <SiGmail size={18} />,
  outlook: <FaMicrosoft size={18} />,
  yahoo: <FaYahoo size={18} />,
  icloud: <SiIcloud size={18} />,
  proton: <SiProtonmail size={18} />,
  aol: <Mail size={18} />,
};

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
  const inbox = inboxProviderFor({ email });

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
        {inbox ? (
          <AuthSecondaryButton href={inbox.url} testId="go-to-inbox">
            {/* Decorative: the button already says where it goes, so the mark
                is hidden from a screen reader rather than read out twice. */}
            <Box
              as="span"
              display="inline-flex"
              alignItems="center"
              aria-hidden="true"
              data-testid="inbox-mark"
              data-provider={inbox.id}
            >
              {INBOX_MARKS[inbox.id]}
            </Box>
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
