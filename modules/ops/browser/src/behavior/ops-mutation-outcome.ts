/** Endpoints return outcome (three states) instead of throwing; onSettled runs both
 * paths to clear pending state. Hook shape (was separate functions). */

import { useCallback } from "react";

import { useOpsToaster, useShowErrorToast } from "./ops-feedback.ts";

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

  /** Variant for count returns; bulk acts report how much moved. */
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
