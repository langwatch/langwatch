import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { organizationTrpc } from "@langwatch/organization-contract";

import type { OrganizationHostApi } from "../../../model/organization-host.ts";

/** The organization's own procedures this card calls, derived from its contract. */
const organizationPolicyApi = createModuleApi<ContractApiMap<typeof organizationTrpc>>();

/**
 * Whether members may connect the docs playground to their own access (ADR-185, amendment of
 * 2026-11-13): state and callbacks, never JSX. On by default; refusals reach the administrator
 * as registry words. Spec: modules/api-key/specs/docs-session-keys.feature
 */
export function useDocsPlaygroundPolicy({
  host,
  organizationId,
}: {
  host: OrganizationHostApi;
  organizationId: string;
}) {
  const utils = organizationPolicyApi.useUtils();
  const enabled = host.hasOrganizationPermission("organization:manage");
  const policy = organizationPolicyApi.organization.getDocsPlaygroundPolicy.useQuery(
    { organizationId },
    { enabled },
  );
  const saveMutation = organizationPolicyApi.organization.saveDocsPlaygroundPolicy.useMutation();

  const save = (docsPlaygroundSessionsEnabled: boolean) => {
    saveMutation.mutate(
      { organizationId, docsPlaygroundSessionsEnabled },
      {
        onSuccess: () => {
          host.succeeded({
            title: "Saved",
            description: docsPlaygroundSessionsEnabled
              ? "Members can connect the docs playground to their own access again."
              : "Members can no longer connect the docs playground, and connections already open have ended.",
          });
          void utils.organization.getDocsPlaygroundPolicy.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save that setting" }),
      },
    );
  };

  return {
    /** Whether the card belongs on the page at all. */
    show: enabled && policy.data !== undefined,
    sessionsEnabled: policy.data?.docsPlaygroundSessionsEnabled ?? true,
    saving: saveMutation.isPending,
    save,
  };
}
