/**
 * Whether an organization space already has something in it, which puts it
 * past the guided onboarding offer: the gateway once any virtual key exists
 * (active or revoked), governance once any ingestion source is connected,
 * the personal home once the user has a personal key or any usage this
 * month. The project home answers this with its traces instead.
 *
 * Each read is the one the page itself runs, with the same input, so the
 * query cache answers it and the offer adds no round trip. Governance is the
 * exception: its overview reads nothing of its own.
 *
 * Null while the answer is unknown (loading, failed, or a read the member
 * may not make), and the offer stays hidden then: a space in use must never
 * flash the pill.
 *
 * @see specs/home/guided-onboarding-offer.feature
 */
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import type { GuidedSpace } from "../landing";

export function useSpaceInUse({
  space,
  enabled,
}: {
  space: GuidedSpace;
  enabled: boolean;
}): boolean | null {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const session = useRequiredSession();
  const organizationId = organization?.id ?? "";
  const userId = session.data?.user?.id;
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const on = enabled && !!organizationId;

  const virtualKeys = api.virtualKeys.list.useQuery(
    { organizationId },
    { enabled: on && space === "gateway" },
  );
  const sources = api.ingestionSources.list.useQuery(
    { organizationId },
    {
      enabled: on && space === "governance" && canReadSources,
      refetchOnWindowFocus: false,
    },
  );
  const personalKeys = api.personalVirtualKeys.list.useQuery(
    { organizationId, targetUserId: userId ?? "" },
    { enabled: on && space === "me" && !!userId, refetchOnWindowFocus: false },
  );
  const personalUsage = api.user.personalUsage.useQuery(
    { organizationId },
    { enabled: on && space === "me", refetchOnWindowFocus: false },
  );

  switch (space) {
    case "project":
      return false;
    case "gateway":
      return virtualKeys.data ? virtualKeys.data.length > 0 : null;
    case "governance":
      if (!canReadSources) return null;
      return sources.data ? sources.data.length > 0 : null;
    case "me":
      if (personalKeys.data && personalKeys.data.length > 0) return true;
      if (!personalKeys.data || !personalUsage.data) return null;
      return personalUsage.data.summary.requests > 0;
  }
}
