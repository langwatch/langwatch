import { useCallback, useRef } from "react";

import type { JoinableOrganization } from "../model/join-before-create.ts";
import { joinLookupDecisionSchema } from "../model/join-lookup.ts";
import { authApi as api } from "./auth-api.ts";
import { hardRedirect } from "./hard-redirect.ts";

/**
 * D12's join-before-create reads and the two ways on. The lookup resolves the
 * caller's verified addresses server-side; the session email only enables it.
 */
export function useJoinBeforeCreate({ enabled }: { enabled: boolean }) {
  const lookup = api.joinRequests.lookup.useQuery(void 0, {
    enabled,
    select: (answer) => joinLookupDecisionSchema.parse(answer),
  });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled });
  const askToJoin = api.joinRequests.request.useMutation();
  const utils = api.useUtils();

  const continueToWorkspaceCreation = useCallback(() => hardRedirect("/"), []);

  const requestJoin = useCallback(
    (organization: JoinableOrganization) => {
      askToJoin.mutate(
        { organizationId: organization.id },
        { onSuccess: () => void utils.joinRequests.mine.invalidate() },
      );
    },
    [askToJoin, utils],
  );

  // Rendering may repeat before navigation; the walk-in must not.
  const admitted = useRef(false);
  const admitAndLand = useCallback(
    (organization: JoinableOrganization) => {
      if (admitted.current) return;
      admitted.current = true;
      askToJoin.mutate({ organizationId: organization.id }, { onSettled: () => hardRedirect("/") });
    },
    [askToJoin],
  );

  return {
    lookup,
    mine,
    requestError: askToJoin.error,
    continueToWorkspaceCreation,
    requestJoin,
    admitAndLand,
  };
}
