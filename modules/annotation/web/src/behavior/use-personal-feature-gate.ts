/** Enables the advanced-features bundle before an annotation hand-off to a dataset. */

import { useCallback, useEffect, useState } from "react";
import { personalWorkspaceFeaturesApi } from "@langwatch/organization-web/personal-workspace-features";

type PendingEnable = {
  projectId: string;
  promise: Promise<boolean>;
  resolve: (enabled: boolean) => void;
};

class PersonalFeatureGateRequest {
  #pending: PendingEnable | undefined;
  #confirming: PendingEnable | undefined;
  readonly #onOpenChange: (open: boolean) => void;

  constructor(onOpenChange: (open: boolean) => void) {
    this.#onOpenChange = onOpenChange;
  }

  request(projectId: string): Promise<boolean> {
    if (this.#pending?.projectId === projectId) return this.#pending.promise;

    this.cancel();

    let resolvePromise: (enabled: boolean) => void = () => {};

    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });

    this.#pending = { projectId, promise, resolve: resolvePromise };
    this.#onOpenChange(true);

    return promise;
  }

  async confirm(
    projectId: string | undefined,
    enable: (input: { projectId: string }) => Promise<unknown>,
  ): Promise<void> {
    const pending = this.#pending;
    if (!pending || this.#confirming === pending) return;

    if (pending.projectId !== projectId) {
      this.#settle(pending, false);

      return;
    }

    this.#confirming = pending;

    try {
      await enable({ projectId: pending.projectId });
      this.#settle(pending, true);
    } catch {
      this.#settle(pending, false);
    } finally {
      if (this.#confirming === pending) this.#confirming = void 0;
    }
  }

  cancel = (): void => {
    if (this.#pending) this.#settle(this.#pending, false);
  };

  #settle(pending: PendingEnable, enabled: boolean): void {
    if (this.#pending !== pending) return;

    this.#pending = void 0;
    pending.resolve(enabled);
    this.#onOpenChange(false);
  }
}

export type PersonalFeatureGate = {
  /** Whether an action has to ask before it goes ahead. */
  isGated: boolean;
  /** Resolves true once the action may proceed, false when the reader backed out. */
  requestEnable: () => Promise<boolean>;
  dialogState: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    isEnabling: boolean;
  };
};

export function usePersonalDatasetGate({
  projectId,
  isOwnPersonalWorkspace,
}: {
  projectId: string | undefined;
  isOwnPersonalWorkspace: boolean;
}): PersonalFeatureGate {
  const features = personalWorkspaceFeaturesApi.personalWorkspaceFeatures.get.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isOwnPersonalWorkspace && !!projectId, refetchOnWindowFocus: false },
  );

  const utils = personalWorkspaceFeaturesApi.useUtils();

  const enableAll = personalWorkspaceFeaturesApi.personalWorkspaceFeatures.enableAll.useMutation({
    onSuccess: () => {
      void utils.personalWorkspaceFeatures.get.invalidate();
    },
  });

  const [open, setOpen] = useState(false);
  const [request] = useState(() => new PersonalFeatureGateRequest(setOpen));
  useEffect(() => request.cancel, [projectId, request]);

  const isGated = isOwnPersonalWorkspace && !features.data?.datasets;

  const requestEnable = useCallback((): Promise<boolean> => {
    if (!isGated) return Promise.resolve(true);

    if (!projectId) return Promise.resolve(false);

    return request.request(projectId);
  }, [isGated, projectId, request]);

  const enable = enableAll.mutateAsync;

  return {
    isGated,
    requestEnable,
    dialogState: {
      open,
      onConfirm: () => void request.confirm(projectId, enable),
      onCancel: request.cancel,
      isEnabling: enableAll.isPending,
    },
  };
}
