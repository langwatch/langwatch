/**
 * The module capabilities the chrome draws, reached through each module's
 * `./declaration` (ARCHITECTURE.md 10.1, "A capability travels by
 * declaration"): organization's join prompts.
 */

import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { lazy, Suspense, type ReactNode } from "react";

const JoinYourTeamTakeover = lazy(organizationWeb.installation.capabilities.joinOffer.load);
const TeamAccessWaiting = lazy(organizationWeb.installation.capabilities.teamAccessWaiting.load);

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
