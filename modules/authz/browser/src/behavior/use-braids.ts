// The Braids screens' reads and writes; a write refreshes the lists and says how it went.

import type { AuthzProjectBraids } from "@langwatch/authz-contract";
import { traceClient } from "@langwatch/trace-client";

import { useAuthzHost } from "../model/authz-host.ts";
import { authzApi } from "./authz-api.ts";

/** Whether only organisation admins may braid; off until it answers. */
export function useBraidsPolicy({ organizationId }: { organizationId: string | undefined }) {
  return authzApi.authz.getBraidsPolicy.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId, retry: false },
  );
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
      void utils.authz.getBraidsPolicy.invalidate();
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

/** Each braid's spans over the last 24 hours, by braid id; undefined until it answers. */
export function useBraidActivity({
  projectId,
  braids,
}: {
  projectId: string | undefined;
  braids: AuthzProjectBraids | undefined;
}): ReadonlyMap<string, number> | undefined {
  const braidIds = [...(braids?.intoOtherProjects ?? []), ...(braids?.fromOtherProjects ?? [])].map(
    (braid) => braid.braidId,
  );
  const activity = traceClient.traces.braidActivity.useQuery(
    { projectId: projectId ?? "", braidIds },
    { enabled: !!projectId && braidIds.length > 0, retry: false },
  );
  if (!activity.data) return undefined;
  return new Map(activity.data.activity.map(({ braidId, spanCount }) => [braidId, spanCount]));
}
