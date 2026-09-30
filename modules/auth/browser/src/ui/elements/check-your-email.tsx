import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";

import { findInboxProvider, type InboxProviderId } from "../../model/inbox-providers.ts";
import { AuthCard } from "./auth-card.tsx";
import { Google } from "./google-icon.tsx";
import { Microsoft } from "./microsoft-icon.tsx";

/** The mark on the inbox door; a provider we hold no mark for wears a plain envelope. */
const INBOX_MARKS: Record<InboxProviderId, ReactNode> = {
  gmail: <Google />,
  outlook: <Microsoft />,
  yahoo: <Mail size={18} />,
  icloud: <Mail size={18} />,
  proton: <Mail size={18} />,
  aol: <Mail size={18} />,
};

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
  const [inbox] = findInboxProvider({ email });

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
        {/* Only for the mailboxes everyone recognizes: a wrong guess is a
            login page for a mailbox the person does not have. */}
        {inbox ? (
          <Button variant="outline" asChild data-testid="go-to-inbox">
            <a href={inbox.url} target="_blank" rel="noreferrer">
              <Box
                as="span"
                display="inline-flex"
                alignItems="center"
                boxSize="18px"
                css={{ "& svg": { width: "100%", height: "100%" } }}
                aria-hidden="true"
                data-testid="inbox-mark"
                data-provider={inbox.id}
              >
                {INBOX_MARKS[inbox.id]}
              </Box>
              Go to inbox
            </a>
          </Button>
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
