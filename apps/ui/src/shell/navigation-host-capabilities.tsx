/**
 * The module capabilities the chrome draws, by `./declaration` (ARCHITECTURE.md
 * 10.1): organization's join prompts, and user's account-security offer where
 * there is no join offer.
 */

import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { userWeb } from "@langwatch/user-browser/declaration";
import { lazy, Suspense, type ReactNode } from "react";

// Fetched with the shell, not on first render: main drew the offer statically, and a
// chunk requested only after the join queries resolve arrives seconds after sign-in.
const joinOfferChunk = organizationWeb.installation.capabilities.joinOffer.load();
const secureAccountNudgeChunk = userWeb.installation.capabilities.secureAccountNudge.load();
const JoinYourTeamTakeover = lazy(() => joinOfferChunk);
const SecureAccountNudge = lazy(() => secureAccountNudgeChunk);
const TeamAccessWaiting = lazy(organizationWeb.installation.capabilities.teamAccessWaiting.load);

export function joinOffer({
  currentOrganizationId,
}: {
  currentOrganizationId: string | null | undefined;
}): ReactNode {
  return (
    <Suspense fallback={null}>
      <JoinYourTeamTakeover
        currentOrganizationId={currentOrganizationId}
        fallback={<SecureAccountNudge />}
      />
    </Suspense>
  );
}

export function teamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}): ReactNode {
  return (
    <Suspense fallback={null}>
      <TeamAccessWaiting organizationName={organizationName} onCheckAccess={onCheckAccess} />
    </Suspense>
  );
}
