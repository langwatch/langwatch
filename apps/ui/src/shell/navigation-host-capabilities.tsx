/**
 * The module capabilities the chrome draws, reached through each module's
 * `./declaration` (ARCHITECTURE.md 10.1, "A capability travels by
 * declaration"): ops' startup notice and organization's join prompts.
 */

import { opsWeb } from "@langwatch/ops-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { lazy, Suspense, type ReactNode } from "react";

const StartupNotice = lazy(opsWeb.installation.capabilities.startupNotice.load);
const JoinYourTeamTakeover = lazy(organizationWeb.installation.capabilities.joinOffer.load);
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
      <JoinYourTeamTakeover currentOrganizationId={currentOrganizationId} />
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
