import { showErrorToast } from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";

interface UseLicenseActionsOptions {
  organizationId: string;
  onUploadSuccess: () => void;
  onRemoveSuccess: () => void;
}

/**
 * What an operator is told once a license is in place. Redeeming an activation
 * code lands in the same place as pasting a license, LangWatch signs one and
 * this install stores it, so both say the same thing.
 *
 * The SSO license gate is decided once per process (ADR-027), so a license
 * activated on a running self-hosted server only enables SSO after a restart.
 */
function activationToast(isSaas: boolean) {
  return {
    title: "License activated",
    description: isSaas
      ? "Your license has been successfully activated."
      : "Your license has been successfully activated. If your deployment uses SSO, restart the server to enable it.",
    type: "success" as const,
  };
}

export function useLicenseActions({
  organizationId,
  onUploadSuccess,
  onRemoveSuccess,
}: UseLicenseActionsOptions) {
  const publicEnv = usePublicEnv();
  // Only a confirmed `true` means Cloud: while the environment is still
  // resolving, showing the restart line is the harmless reading, and omitting
  // it on a self-hosted deployment is not.
  const isSaas = publicEnv.data?.IS_SAAS === true;

  // Activating or removing a license moves the active plan, which half the app
  // reads: navigation, feature gates, limit copy. Invalidating every query is
  // the blunt instrument that catches all of them, and it is what replaced a
  // `window.location.reload()` here. The reload refreshed the same state, and
  // destroyed the toast on its way: the restart instruction is the one thing an
  // operator has to read, and it was being torn off the screen milliseconds
  // after it appeared.
  const trpc = api.useUtils();
  const refreshPlanDerivedState = () => {
    void trpc.invalidate();
  };

  const announceActivated = () => {
    toaster.create(activationToast(isSaas));
    onUploadSuccess();
    refreshPlanDerivedState();
  };

  const uploadMutation = api.license.upload.useMutation({
    onSuccess: announceActivated,
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't activate license" }),
  });

  const activateMutation = api.license.activate.useMutation({
    onSuccess: announceActivated,
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't redeem activation code",
      }),
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License removed",
        description:
          "Your organization is now running without a license. Some features may be limited.",
        type: "info",
      });
      onRemoveSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't remove license" }),
  });

  // A refresh syncs the license with LangWatch now, so a seat change made on
  // the registry lands without waiting for the daily pass. The answer says
  // whether anything changed, and a changed license moves the plan the same
  // way an activation does.
  const refreshMutation = api.license.refresh.useMutation({
    onSuccess: (result) => {
      if (result.outcome !== "updated") {
        toaster.create({
          title: "Your license is up to date",
          description: "LangWatch has no newer license for this install.",
          type: "info",
        });
        return;
      }
      toaster.create({
        title: "License updated",
        description: `Your license now covers ${result.maxMembers} ${
          result.maxMembers === 1 ? "seat" : "seats"
        }.`,
        type: "success",
      });
      onUploadSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't refresh license" }),
  });

  return {
    upload: (licenseKey: string) =>
      uploadMutation.mutate({ organizationId, licenseKey }),
    activate: (code: string) =>
      activateMutation.mutate({ organizationId, code }),
    remove: () => removeMutation.mutate({ organizationId }),
    refresh: () => refreshMutation.mutate({ organizationId }),
    isUploading: uploadMutation.isPending || activateMutation.isPending,
    isRemoving: removeMutation.isPending,
    isRefreshing: refreshMutation.isPending,
  };
}
