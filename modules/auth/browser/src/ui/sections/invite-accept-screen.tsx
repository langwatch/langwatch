import { Text } from "@langwatch/design-system/primitives";

import { useRouter } from "../../behavior/use-route.ts";
import { usePublishFrontDoorStage } from "../../model/ground-stage.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { SecondaryActionLink } from "../elements/secondary-action-link.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";
import { InviteLanding } from "./invite-landing.tsx";

/** Invitation link landing (ADR-117 §6, D13): says who is asking before anything happens. */
export default function Accept() {
  const inviteCode = useRouter().query.inviteCode;

  return (
    <FrontDoorShell>
      {typeof inviteCode === "string" && inviteCode.length > 0 ? (
        <InviteLanding inviteCode={inviteCode} />
      ) : (
        <IncompleteInviteLink />
      )}
    </FrontDoorShell>
  );
}

/**
 * Email clients cut long links in half, so a code-less arrival is ordinary.
 * It names no organization: nothing was looked up, so nothing was found.
 */
function IncompleteInviteLink() {
  usePublishFrontDoorStage({ door: "signin", depth: "entry" });

  return (
    <AuthCard
      title="This invitation link is incomplete"
      intro="Some email clients cut long links in half. Open the one in your inbox again, or ask whoever invited you for a fresh link."
    >
      <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted" data-testid="invite-incomplete">
        Nothing has been accepted, and nothing expires while you sort it out.
      </Text>
      <SecondaryActionLink href="/auth/signin" label="Go to sign in" />
    </AuthCard>
  );
}
