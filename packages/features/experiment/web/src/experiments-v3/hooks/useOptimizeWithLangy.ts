import { useCallback } from "react";

import { absorbContextTarget } from "@langwatch/langy-web";
import { useLangyStore } from "@langwatch/langy-web";
import { useFeatureFlag } from "@langwatch/workflow-web/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import type { TargetConfig } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/**
 * The "Optimize this prompt" handoff: choose the experiment chip the page
 * already offers, absorb the target's prompt as picked context, and hand
 * Langy an auto-sent ask. The chips ride along because `askLangy` keeps
 * `chosenChipIds` (arm, absorb, ask is the ordinary order of the gesture);
 * the cost gate lives in the skill's own ask-before-spending rule, not here.
 *
 * Returns undefined while the UI-action channel is flagged off, which is
 * what hides the menu item.
 */
type OptimizeHandler = ({
  target,
  name,
}: {
  target: TargetConfig;
  name: string;
}) => void;

export const useOptimizeWithLangy = (): OptimizeHandler | undefined => {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const uiActionsEnabled = useFeatureFlag("release_langy_ui_actions", {
    projectId: project?.id,
    organizationId: organization?.id,
    enabled: !!project?.id,
  });

  const optimize = useCallback<OptimizeHandler>(({ target, name }) => {
    const slug = useEvaluationsV3Store.getState().experimentSlug;
    const { chooseChip, askLangy } = useLangyStore.getState();
    if (slug) chooseChip(`experiment:${slug}`);
    if (target.promptId) {
      absorbContextTarget({
        id: `prompt:${target.promptId}`,
        kind: "prompt",
        label: `prompt: ${name}`,
        ref: target.promptId,
      });
    }
    askLangy(
      `Optimize the prompt in the "${name}" column. Keep that column unchanged as the baseline and work on a duplicate.`,
    );
  }, []);

  return uiActionsEnabled.enabled ? optimize : undefined;
};
