import { Text } from "@chakra-ui/react";

import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell, InviteLanding } from "~/features/auth";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The invitation link's landing (ADR-117 §6, D13).
 *
 * It is a screen: it says who is asking before anything happens, takes a
 * signed-out visitor through sign-in or sign-up with the invitation still in
 * hand, and asks a signed-in one to confirm. It used to be a page that
 * accepted on arrival and needed a session to reach at all; that half is
 * deleted, along with the setting that chose between them.
 */
export default function Accept() {
  const router = useRouter();
  const inviteCode = router.query.inviteCode;

  // The auth screens's ground under the auth screens' card, the way every other
  // enforced screen composes it. The landing was rendering its card on blank
  // paper, which made an invitation the one arrival that did not look like
  // the sign-in it leads to.
  return (
    <AuthShell>
      {typeof inviteCode === "string" && inviteCode.length > 0 ? (
        <InviteLanding inviteCode={inviteCode} />
      ) : (
        <IncompleteInviteLink />
      )}
    </AuthShell>
  );
}

/**
 * The link arrived with no code in it — cut in half by a mail client, or
 * typed short. It names no organization because there is none to name: nothing
 * was looked up, so nothing was found, and a dead end that describes what it
 * did not find is a way to learn which organizations exist.
 */
function IncompleteInviteLink() {
  usePublishAuthStage({ door: "signin", depth: "entry" });

  return (
    <AuthCard
      title="This invitation link is incomplete"
      intro="Some email clients cut long links in half. Open the one in your inbox again, or ask whoever invited you for a fresh link."
    >
      <Text
        fontSize="13.5px"
        lineHeight="1.65"
        color="fg.muted"
        data-testid="invite-incomplete"
      >
        Nothing has been accepted, and nothing expires while you sort it out.
      </Text>
    </AuthCard>
  );
}
