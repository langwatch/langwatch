import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import type { InstantEvalOptInOffer } from "~/server/app-layer/instant-evals/opt-in";
import { api } from "~/utils/api";

export interface InstantEvalAccess {
  /**
   * Whether an eval-chip submit may go on to the estimate. True while either
   * read is in flight: if the server then refuses, the user gets the popover
   * and the phrase search fallback, so a slow read never hides a feature the
   * project actually has.
   */
  isAvailable: boolean;
  /** What the popover offers a refused reader: the switch, or a word with us. */
  optInOffer: InstantEvalOptInOffer | undefined;
}

/**
 * Whether the project may judge with Instant Evals: the release flag or the
 * organization's own switch, either one is enough.
 */
export function useInstantEvalAccess({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}): InstantEvalAccess {
  const { enabled: flagReleased, isLoading: flagLoading } = useFeatureFlag(
    "release_instant_evals",
    {
      projectId,
      organizationId,
      enabled: !!projectId && !!organizationId,
    },
  );
  const access = api.tracesV2.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: 5 * 60 * 1000 },
  );
  return {
    isAvailable:
      flagReleased ||
      flagLoading ||
      !!access.data?.released ||
      access.isLoading,
    optInOffer: access.data?.offer,
  };
}
