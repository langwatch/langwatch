import { connectApi } from "../../behavior/connect-api.ts";
import { licensingApi } from "../../behavior/licensing-api.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";

interface UseLicenseActionsOptions {
  organizationId: string;
  onUploadSuccess: () => void;
  onRemoveSuccess: () => void;
}

export function useLicenseActions({
  organizationId,
  onUploadSuccess,
  onRemoveSuccess,
}: UseLicenseActionsOptions) {
  const host = useLicensingHost();
  // The SSO license gate is decided once per process (ADR-027), so a license
  // activated on a running self-hosted server only enables SSO after a restart.
  // Only a confirmed `true` means Cloud: while the environment is still
  // resolving, showing the restart line is the harmless reading, and omitting
  // it on a self-hosted deployment is not.
  const isSaas = host.isDeploymentSettled() && host.isSaaS();

  // Activating or removing a license moves the active plan, which half the
  // app reads (navigation, feature gates, limit copy). Invalidating every
  // query catches all of them — a page reload would tear the restart
  // instruction off-screen the moment it appeared.
  const refreshPlanDerivedState = () => {
    host.refreshPlanDerivedState();
  };

  const announceActivated = () => {
    host.succeeded({
      title: "License activated",
      description: isSaas
        ? "Your license has been successfully activated."
        : "Your license has been successfully activated. If your deployment uses SSO, restart the server to enable it.",
    });
    onUploadSuccess();
    refreshPlanDerivedState();
  };

  const uploadMutation = licensingApi.license.upload.useMutation({
    onSuccess: announceActivated,
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't activate license" }),
  });

  const activateMutation = licensingApi.license.activate.useMutation({
    onSuccess: announceActivated,
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't redeem activation code" }),
  });

  const removeMutation = licensingApi.license.remove.useMutation({
    onSuccess: () => {
      host.succeeded({
        title: "License removed",
        description:
          "Your organization is now running without a license. Some features may be limited.",
      });
      onRemoveSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't remove license" }),
  });

  const refreshMutation = connectApi.connect.refreshLicense.useMutation({
    onSuccess: (result) => {
      if (result.outcome !== "updated") {
        host.succeeded({
          title: "Your license is up to date",
          description: "LangWatch has no newer license for this install.",
        });
        return;
      }
      host.succeeded({
        title: "License updated",
        description: `Your license now covers ${result.maxMembers} ${
          result.maxMembers === 1 ? "seat" : "seats"
        }.`,
      });
      onUploadSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't refresh license" }),
  });

  const upload = (licenseKey: string) => {
    uploadMutation.mutate({ organizationId, licenseKey });
  };

  const activate = (code: string) => {
    activateMutation.mutate({ organizationId, code });
  };

  const remove = () => {
    removeMutation.mutate({ organizationId });
  };

  const refresh = () => {
    refreshMutation.mutate({ organizationId });
  };

  return {
    upload,
    activate,
    remove,
    refresh,
    isUploading: uploadMutation.isPending || activateMutation.isPending,
    isRemoving: removeMutation.isPending,
    isRefreshing: refreshMutation.isPending,
  };
}
