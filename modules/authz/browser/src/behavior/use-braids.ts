// The Braids screens' reads and writes; a write refreshes the lists and says how it went.

import type { AuthzProjectBraids } from "@langwatch/authz-contract";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { traceClient } from "@langwatch/trace-client";

import { useAuthzHost } from "../model/authz-host.ts";
import type { BraidActivityCounts } from "../model/braids/braids.ts";
import { authzApi } from "./authz-api.ts";

/** `release_braids` for this organisation; undefined until it answers. */
export function useBraidsReleased(): boolean | undefined {
  return useUiFlags().flag(FrontendFlags.release_braids);
}

/** Whether only organisation admins may braid; off until it answers, never asked unreleased. */
export function useBraidsPolicy({ organizationId }: { organizationId: string | undefined }) {
  return authzApi.authz.getBraidsPolicy.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId, retry: false },
  );
}

/**
 * The organisation's braid settings as the project page reads them. Off is known, never assumed:
 * an unread setting leaves the server to refuse by name. Off holds with the release flag off too.
 */
export function useBraidsSettings({ organizationId }: { organizationId: string | undefined }) {
  const policy = useBraidsPolicy({ organizationId });
  return {
    keptToAdmins: policy.data?.braidsOrganizationAdminsOnly ?? false,
    turnedOff: policy.data?.braidsEnabled === false,
    /** The setting as read; undefined until it answers or when the read fails. */
    turnedOn: policy.data?.braidsEnabled,
  };
}

export function useProjectBraids({ projectId }: { projectId: string | undefined }) {
  return authzApi.authz.listBraids.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, retry: false },
  );
}

export function useOrganizationBraids({ organizationId }: { organizationId: string | undefined }) {
  return authzApi.authz.listOrganizationBraids.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId, retry: false },
  );
}

export function useRemoveBraid({ onRemoved }: { onRemoved: () => void }) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const removal = authzApi.authz.removeBraid.useMutation({
    onSuccess: () => {
      void utils.authz.listBraids.invalidate();
      void utils.authz.listOrganizationBraids.invalidate();
      host.succeeded({ title: "Braid removed", description: "The removal is in the audit log." });
      onRemoved();
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't remove the braid" }),
  });
  return {
    isRemoving: removal.isPending,
    remove: ({ projectId, braidId }: { projectId: string; braidId: string }) =>
      removal.mutate({ projectId, braidId }),
  };
}

export function useSetBraidsPolicy({ organizationId }: { organizationId: string }) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const setting = authzApi.authz.setBraidsPolicy.useMutation({
    onSuccess: (policy) => {
      utils.authz.getBraidsPolicy.setData({ organizationId }, policy);
      host.succeeded({
        title: policy.braidsOrganizationAdminsOnly
          ? "Braids are kept to organisation admins"
          : "Project admins can braid again",
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change who may braid" }),
  });
  return {
    isSaving: setting.isPending,
    set: (braidsOrganizationAdminsOnly: boolean) =>
      setting.mutate({ organizationId, braidsOrganizationAdminsOnly }),
  };
}

/** Turns Braids on or off for the organisation; off pauses its braids and keeps them. */
export function useSetBraidsEnabled({ organizationId }: { organizationId: string }) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const setting = authzApi.authz.setBraidsEnabled.useMutation({
    onSuccess: (policy) => {
      utils.authz.getBraidsPolicy.setData({ organizationId }, policy);
      host.succeeded({
        title: policy.braidsEnabled ? "Braids is on" : "Braids is off",
        description: policy.braidsEnabled
          ? "Projects can now braid, and any paused braids show their spans again."
          : "Existing braids are paused and kept. The change is in the audit log.",
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't turn Braids on or off" }),
  });
  return {
    isSaving: setting.isPending,
    set: (braidsEnabled: boolean) => setting.mutate({ organizationId, braidsEnabled }),
  };
}

/**
 * Both organisation settings for the organisation screen. Each save answers with the whole policy
 * and writes it to the cache, so a late answer could undo the other switch's newer value: while
 * either save is pending, `isSaving` holds both switches.
 */
export function useSetBraidsSettings({ organizationId }: { organizationId: string }) {
  const keepToAdmins = useSetBraidsPolicy({ organizationId });
  const enable = useSetBraidsEnabled({ organizationId });
  return {
    isSaving: keepToAdmins.isSaving || enable.isSaving,
    setKeptToAdmins: keepToAdmins.set,
    setEnabled: enable.set,
  };
}

/** Each braid's spans over the last 24 hours, by braid id; undefined until it answers. */
export function useBraidActivity({
  projectId,
  braids,
  enabled,
}: {
  projectId: string | undefined;
  braids: AuthzProjectBraids | undefined;
  /** Off below Enterprise, unreleased or turned off: a paused braid counts nothing. */
  enabled: boolean;
}): BraidActivityCounts {
  const braidIds = [...(braids?.intoOtherProjects ?? []), ...(braids?.fromOtherProjects ?? [])].map(
    (braid) => braid.braidId,
  );
  const activity = traceClient.traces.braidActivity.useQuery(
    { projectId: projectId ?? "", braidIds },
    { enabled: enabled && !!projectId && braidIds.length > 0, retry: false },
  );
  if (activity.isError) return "failed";
  if (!activity.data) return undefined;
  return new Map(activity.data.activity.map(({ braidId, spanCount }) => [braidId, spanCount]));
}
