/**
 * Click-to-enable gate for the personal workspace's advanced features.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/me/usePersonalFeatureGate.ts`,
 * which keeps its other callers in the trace explorer and so did not travel.
 *
 * WHAT IT GATES HERE is one action: handing picked rows to a dataset. Datasets
 * are part of the same bundle annotations are, so a reviewer on their own
 * personal workspace with the bundle off is offered the switch from the place
 * they tried to use it rather than being sent to `/me/configure` and back.
 *
 * NARROWED to the one feature this family asks about. The platform hook takes a
 * feature key because four surfaces share it; here the answer is always about
 * datasets, so the key is not a parameter and the dialog's copy is not a
 * lookup.
 *
 * WHETHER THE READER IS ON THEIR OWN PERSONAL WORKSPACE IS THE HOST'S ANSWER,
 * not a second read: `personalWorkspaceFeatures.get` refuses with NOT_FOUND for
 * anybody else's project, so asking it to find out would be asking a question
 * whose refusal is the answer.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 *       @modal scenarios — modal-flow (b), one-step continuation.
 */

import { useCallback, useMemo, useState } from "react";
import type { PersonalFeatureGateDialogState } from "../model/personal-feature-gate-state";
import { annotationApi } from "./annotation-api";

export type PersonalFeatureGate = {
  /** Whether an action has to ask before it goes ahead. */
  isGated: boolean;
  /** Resolves true once the action may proceed, false when the reader backed out. */
  requestEnable: () => Promise<boolean>;
  dialogState: PersonalFeatureGateDialogState;
};

export function usePersonalDatasetGate({
  projectId,
  isOwnPersonalWorkspace,
}: {
  projectId: string | undefined;
  isOwnPersonalWorkspace: boolean;
}): PersonalFeatureGate {
  const features = annotationApi.personalWorkspaceFeatures.get.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isOwnPersonalWorkspace && !!projectId, refetchOnWindowFocus: false },
  );
  const utils = annotationApi.useUtils();
  const enableAll = annotationApi.personalWorkspaceFeatures.enableAll.useMutation({
    onSuccess: () => {
      if (projectId) {
        void utils.personalWorkspaceFeatures.get.invalidate({ projectId });
      }
    },
  });

  const [pendingResolve, setPendingResolve] = useState<((value: boolean) => void) | null>(null);

  const isGated = isOwnPersonalWorkspace && !features.data?.datasets;

  const requestEnable = useCallback((): Promise<boolean> => {
    if (!isGated) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPendingResolve(() => resolve));
  }, [isGated]);

  const enable = enableAll.mutateAsync;
  const onConfirm = useCallback(async () => {
    if (!projectId || !pendingResolve) return;
    try {
      await enable({ projectId });
      pendingResolve(true);
    } catch {
      pendingResolve(false);
    } finally {
      setPendingResolve(null);
    }
  }, [projectId, pendingResolve, enable]);

  const onCancel = useCallback(() => {
    if (!pendingResolve) return;
    pendingResolve(false);
    setPendingResolve(null);
  }, [pendingResolve]);

  const dialogState = useMemo(
    () => ({
      open: pendingResolve !== null,
      onConfirm: () => void onConfirm(),
      onCancel,
      isEnabling: enableAll.isPending,
    }),
    [pendingResolve, onConfirm, onCancel, enableAll.isPending],
  );

  return { isGated, requestEnable, dialogState };
}
