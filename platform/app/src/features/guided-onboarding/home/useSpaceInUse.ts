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
 * flash the pill. A read that failed is unknown even with an earlier answer
 * still in the cache, since the cache keeps the last list through a failed
 * refetch and that list may be the empty one from before the space was used.
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
  const meOn = on && space === "me";

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
    { enabled: meOn && !!userId, refetchOnWindowFocus: false },
  );
  const personalUsage = api.user.personalUsage.useQuery(
    { organizationId },
    { enabled: meOn, refetchOnWindowFocus: false },
  );

  switch (space) {
    case "project":
      return false;
    case "gateway":
      return hasAny(virtualKeys);
    case "governance":
      return canReadSources ? hasAny(sources) : null;
    case "me":
      return personalSpaceInUse({ personalKeys, personalUsage });
  }
}

interface SpaceRead<T> {
  data: T | undefined;
  isError: boolean;
}

/**
 * `data` alone cannot be trusted: the query cache keeps the last answer
 * through a failed refetch, so a read that failed has answered nothing.
 */
function settled<T>(read: SpaceRead<T>): T | undefined {
  return read.isError ? undefined : read.data;
}

/** Null is "not known yet", which keeps the offer hidden; false shows it. */
function hasAny(read: SpaceRead<readonly unknown[]>): boolean | null {
  const list = settled(read);
  return list ? list.length > 0 : null;
}

/**
 * A personal key alone settles it; otherwise both reads must be in before
 * usage this month can answer.
 */
function personalSpaceInUse({
  personalKeys,
  personalUsage,
}: {
  personalKeys: SpaceRead<readonly unknown[]>;
  personalUsage: SpaceRead<{ summary: { requests: number } }>;
}): boolean | null {
  const hasKey = hasAny(personalKeys);
  if (hasKey !== false) return hasKey;
  const requests = settled(personalUsage)?.summary.requests;
  return requests === undefined ? null : requests > 0;
}
