/**
 * Whether the project may judge with Instant Evals: the release flag or the
 * organization's own switch. The access read also says what the popover
 * offers a refused reader.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";

import {
  type InstantEvalOptInOffer,
  isInstantEvalAvailable,
} from "../../../model/instant-eval-access.ts";
import { api } from "../../trace-api.ts";

export interface InstantEvalAccess {
  /** Whether an eval-chip submit may go on to the estimate. */
  isAvailable: boolean;
  /** What the popover offers a refused reader; absent until the server says. */
  optInOffer: InstantEvalOptInOffer | undefined;
}

const ACCESS_STALE_MS = 5 * 60 * 1000;

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
    { enabled: !!projectId, staleTime: ACCESS_STALE_MS },
  );
  return {
    isAvailable: isInstantEvalAvailable({
      flagReleased,
      flagLoading,
      accessReleased: !!access.data?.released,
      accessLoading: access.isLoading,
    }),
    optInOffer: access.data?.offer,
  };
}
