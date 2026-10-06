/**
 * Whether the project may judge with Instant Evals: the release flag or the
 * organization's own switch, either is enough (main #8348).
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";
import type { ExplorerInstantEvalOptInAccess } from "@langwatch/trace-contract";

import { api } from "../../../../behavior/trace-api.ts";

export interface InstantEvalAccess {
  /** True while either read is in flight: a server refusal then says why. */
  isAvailable: boolean;
  /** What the popover offers a refused reader: the switch, an admin, or us. */
  optInOffer: ExplorerInstantEvalOptInAccess["offer"] | undefined;
}

export function useInstantEvalAccess({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}): InstantEvalAccess {
  const { enabled: flagReleased, isLoading: flagLoading } = useFeatureFlag(
    "release_instant_evals",
    { projectId, organizationId, enabled: !!projectId && !!organizationId },
  );
  const access = api.traces.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: 5 * 60 * 1000 },
  );

  return {
    isAvailable: flagReleased || flagLoading || !!access.data?.released || access.isLoading,
    optInOffer: access.data?.offer,
  };
}
