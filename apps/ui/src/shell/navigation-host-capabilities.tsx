/**
 * The module capabilities the chrome draws, by `./declaration` (ARCHITECTURE.md
 * 10.1): organization's join prompts, user's account-security offer where
 * there is no join offer, and user's second-factor enrolment gate.
 */

import { lazyChunk, loadChunk } from "@langwatch/browser-host/navigation";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { userWeb } from "@langwatch/user-browser/declaration";
import { lazy, Suspense, type ReactNode } from "react";

// Fetched with the shell, not on first render: main drew the offer statically, and a
// chunk requested only after the join queries resolve arrives seconds after sign-in.
const joinOfferChunk = loadChunk(organizationWeb.installation.capabilities.joinOffer.load);
const secureAccountNudgeChunk = loadChunk(
  userWeb.installation.capabilities.secureAccountNudge.load,
);
const JoinYourTeamTakeover = lazy(() => joinOfferChunk);
const SecureAccountNudge = lazy(() => secureAccountNudgeChunk);
const TeamAccessWaiting = lazyChunk(
  organizationWeb.installation.capabilities.teamAccessWaiting.load,
);
const organizationMfaGateChunk = loadChunk(
  userWeb.installation.capabilities.organizationMfaGate.load,
);
const OrganizationMfaGate = lazy(() => organizationMfaGateChunk);

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

/** Fetched with the shell, so the body waits on no chunk of its own after the first paint. */
export function organizationMfaGate({
  organizationId,
  isPersonalScope,
  body,
}: {
  organizationId: string | undefined;
  isPersonalScope: boolean;
  body: ReactNode;
}): ReactNode {
  return (
    <Suspense fallback={null}>
      <OrganizationMfaGate organizationId={organizationId} isPersonalScope={isPersonalScope}>
        {body}
      </OrganizationMfaGate>
    </Suspense>
  );
}
