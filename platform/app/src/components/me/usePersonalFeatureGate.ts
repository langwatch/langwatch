import { useCallback, useMemo, useState } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

export type PersonalFeatureKey =
  | "evaluations"
  | "datasets"
  | "annotations"
  | "automations";

/**
 * Click-to-enable gate for personal-workspace advanced features. Used
 * inside the trace explorer (and any other surface that triggers an
 * advanced action) so the user can flip the bundle from the place they
 * tried to use it, with one-step continuation per modal-flow (b).
 *
 * Behavior:
 * - When the user is NOT on their own personal project, returns
 *   `isGated: false` and `requestEnable` resolves true synchronously.
 *   Existing behavior — non-personal projects don't have the bundle
 *   model.
 * - When the user IS on their own personal project AND the feature is
 *   already enabled, same shape — `isGated: false`, immediate true.
 * - When the user IS on their own personal project AND the feature is
 *   off, exposes `isGated: true`. The consumer renders the gate dialog
 *   driven by `dialogState`. On confirm, fires `enableAll` and resolves
 *   true. On cancel, resolves false (caller should bail).
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 *       @modal scenarios — modal-flow (b), one-step continuation
 */
export function usePersonalFeatureGate(feature: PersonalFeatureKey): {
  isGated: boolean;
  requestEnable: () => Promise<boolean>;
  dialogState: {
    open: boolean;
    feature: PersonalFeatureKey;
    onConfirm: () => void;
    onCancel: () => void;
    isEnabling: boolean;
  };
} {
  const session = useRequiredSession();
  const userId = session.data?.user?.id;
  const { project, team } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === userId;

  const featuresQuery = api.personalWorkspaceFeatures.get.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: isOnOwnPersonalProject && !!project?.id,
      refetchOnWindowFocus: false,
    },
  );
  const featureEnabled = !!featuresQuery.data?.[feature];

  const utils = api.useUtils();
  const enableMutation = api.personalWorkspaceFeatures.enableAll.useMutation({
    onSuccess: () => {
      if (project?.id) {
        void utils.personalWorkspaceFeatures.get.invalidate({
          projectId: project.id,
        });
      }
    },
  });

  const [pendingResolve, setPendingResolve] = useState<
    ((value: boolean) => void) | null
  >(null);

  const isGated = isOnOwnPersonalProject && !featureEnabled;

  const requestEnable = useCallback((): Promise<boolean> => {
    if (!isGated) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPendingResolve(() => resolve);
    });
  }, [isGated]);

  const onConfirm = useCallback(async () => {
    if (!project?.id || !pendingResolve) return;
    try {
      await enableMutation.mutateAsync({ projectId: project.id });
      pendingResolve(true);
    } catch {
      pendingResolve(false);
    } finally {
      setPendingResolve(null);
    }
  }, [project?.id, pendingResolve, enableMutation]);

  const onCancel = useCallback(() => {
    if (pendingResolve) {
      pendingResolve(false);
      setPendingResolve(null);
    }
  }, [pendingResolve]);

  const dialogState = useMemo(
    () => ({
      open: pendingResolve !== null,
      feature,
      onConfirm,
      onCancel,
      isEnabling: enableMutation.isPending,
    }),
    [pendingResolve, feature, onConfirm, onCancel, enableMutation.isPending],
  );

  return { isGated, requestEnable, dialogState };
}
