/**
 * The module capabilities the chrome draws, by `./declaration` (ARCHITECTURE.md
 * 10.1): ops' startup notice, organization's join prompts, and user's
 * account-security offer where there is no join offer.
 */

import { opsWeb } from "@langwatch/ops-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { userWeb } from "@langwatch/user-browser/declaration";
import { lazy, Suspense, type ReactNode } from "react";

const StartupNotice = lazy(opsWeb.installation.capabilities.startupNotice.load);
const JoinYourTeamTakeover = lazy(organizationWeb.installation.capabilities.joinOffer.load);
const SecureAccountNudge = lazy(userWeb.installation.capabilities.secureAccountNudge.load);
const TeamAccessWaiting = lazy(organizationWeb.installation.capabilities.teamAccessWaiting.load);

export function startupNotice(): ReactNode {
  return (
    <Suspense fallback={null}>
      <StartupNotice />
    </Suspense>
  );
}

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
