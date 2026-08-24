import { Text } from "@chakra-ui/react";
import { AuthCard } from "~/components/auth/AuthCard";

/**
 * The one state both doors end at when an address has to be confirmed: the
 * link is out, and there is nothing to do here until it comes back.
 *
 * Sign-up and a log-in that turned out to be a sign-up render the same card
 * with the same shape, because to the person waiting they are the same thing.
 */
export function CheckYourEmail({
  email,
  what,
}: {
  email: string;
  /** What the link does when they open it, in their words. */
  what: string;
}) {
  return (
    <AuthCard title="Check your email">
      <Text data-testid="verification-sent">
        We sent a link to <b>{email}</b>. {what} The link expires in 1 hour.
      </Text>
    </AuthCard>
  );
}
