/**
 * Whether the project may judge with Instant Evals, as the server answers it: the plan decides
 * whether the release flag or the organization's own switch counts, so the browser never reads
 * the flag itself (main #8348).
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import type { ExplorerInstantEvalOptInAccess } from "@langwatch/trace-contract";

import { api } from "../../../behavior/trace-api.ts";

export interface InstantEvalAccess {
  /** True while the read is in flight: a server refusal then says why. */
  isAvailable: boolean;
  /** What the popover offers a refused reader: the switch, an admin, or us. */
  optInOffer: ExplorerInstantEvalOptInAccess["offer"] | undefined;
  /** The install judges through LangWatch: "can't run right now" names the two addresses. */
  viaConnect: boolean;
}

export function useInstantEvalAccess({
  projectId,
}: {
  projectId: string | undefined;
}): InstantEvalAccess {
  const access = api.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: 5 * 60 * 1000 },
  );

  return {
    isAvailable: !!access.data?.released || access.isLoading,
    optInOffer: access.data?.offer,
    viaConnect: !!access.data?.viaConnect,
  };
}
