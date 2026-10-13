import { useToast } from "@langwatch/design-system-internal";
import { useState } from "react";

import { postAction } from "./api.ts";

export type LifecycleRequest = {
  /** Which button is busy: a slug or a worktree directory. */
  key: string;
  path: string;
  body?: unknown;
  /** The verb for the failure toast: "restart feat-x". */
  doing: string;
};

/** Restart and start, as the hub and every home take them: a toast says what happened. */
export const useLifecycle = ({ refresh }: { refresh: () => Promise<void> }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const act = async ({ key, path, body, doing }: LifecycleRequest) => {
    setBusy(key);
    try {
      const message = await postAction({ path, body });
      toast.show({ title: message, tone: "ok" });
      await refresh();
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.show({ title: `Could not ${doing}`, description, tone: "error" });
    } finally {
      setBusy(undefined);
    }
  };

  return { busy, act };
};
