/**
 * The handler shape every Ops recovery mutation shares.
 *
 * These endpoints answer with a boolean rather than throwing when the row moved
 * on under the operator — a message that was redriven by someone else a second
 * earlier is not an error, it is a different outcome — so each one needs three
 * strings: it worked, it no longer applied, it failed.
 *
 * `onSettled` runs on BOTH paths. It is what clears the caller's pending state,
 * and a failure that left the row spinning forever would be worse than the
 * failure itself.
 *
 * A HOOK RATHER THAN TWO FUNCTIONS, and that is the only change from
 * `platform/app/src/components/ops/shared/mutationOutcome.ts`: the toaster and
 * the error toast are the host's now, and a host is read through context. Every
 * caller was already a hook, so the call sites moved one line up and no handler
 * body changed.
 */

import { useCallback } from "react";
import { useOpsToaster, useShowErrorToast } from "./ops-feedback";

export type MutationOutcomeHandlers = {
  onSuccess: (data: Record<string, unknown>) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
};

export type OpsMutationOutcomes = {
  mutationOutcomeHandlers: (options: {
    onSettled: () => void;
    applied: string;
    missed: string;
    failure: string;
  }) => MutationOutcomeHandlers;
  countOutcomeHandlers: (options: {
    onSettled: () => void;
    title: (count: number) => string;
    failure: string;
  }) => MutationOutcomeHandlers;
};

export function useOpsMutationOutcomes(): OpsMutationOutcomes {
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();

  const mutationOutcomeHandlers = useCallback(
    ({
      onSettled,
      applied,
      missed,
      failure,
    }: {
      onSettled: () => void;
      applied: string;
      missed: string;
      failure: string;
    }): MutationOutcomeHandlers => ({
      onSuccess: (data: Record<string, unknown>) => {
        const isApplied = Object.values(data).some((value) => value === true);
        toaster.create({
          title: isApplied ? applied : missed,
          type: isApplied ? ("success" as const) : ("error" as const),
        });
      },
      onError: (error: unknown) => showErrorToast({ error, fallbackTitle: failure }),
      onSettled,
    }),
    [toaster, showErrorToast],
  );

  /**
   * The same, for a mutation that returns a COUNT rather than a boolean: bulk
   * acts report how much moved, and zero is a legitimate answer worth saying
   * out loud.
   */
  const countOutcomeHandlers = useCallback(
    ({
      onSettled,
      title,
      failure,
    }: {
      onSettled: () => void;
      title: (count: number) => string;
      failure: string;
    }): MutationOutcomeHandlers => ({
      onSuccess: (data: Record<string, unknown>) => {
        const count = Object.values(data).find(
          (value): value is number => typeof value === "number",
        );
        toaster.create({ title: title(count ?? 0), type: "success" as const });
      },
      onError: (error: unknown) => showErrorToast({ error, fallbackTitle: failure }),
      onSettled,
    }),
    [toaster, showErrorToast],
  );

  return { mutationOutcomeHandlers, countOutcomeHandlers };
}
