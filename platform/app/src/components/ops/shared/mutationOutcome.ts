import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";

/**
 * The handler shape every ops recovery mutation shares.
 *
 * These endpoints answer with a boolean rather than throwing when the row
 * moved on under the operator — a message that was redriven by someone else a
 * second earlier is not an error, it is a different outcome — so each one
 * needs three strings: it worked, it no longer applied, it failed.
 */
export function mutationOutcomeHandlers({
  onSettled,
  applied,
  missed,
  failure,
}: {
  onSettled: () => void;
  applied: string;
  missed: string;
  failure: string;
}) {
  return {
    onSuccess: (data: Record<string, unknown>) => {
      const ok = Object.values(data).some((value) => value === true);
      toaster.create({
        title: ok ? applied : missed,
        type: ok ? ("success" as const) : ("error" as const),
      });
      onSettled();
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: failure }),
  };
}

/**
 * The same, for a mutation that returns a COUNT rather than a boolean: bulk
 * acts report how much moved, and zero is a legitimate answer worth saying
 * out loud.
 */
export function countOutcomeHandlers({
  onSettled,
  title,
  failure,
}: {
  onSettled: () => void;
  title: (count: number) => string;
  failure: string;
}) {
  return {
    onSuccess: (data: Record<string, unknown>) => {
      const count = Object.values(data).find(
        (value): value is number => typeof value === "number",
      );
      toaster.create({ title: title(count ?? 0), type: "success" as const });
      onSettled();
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: failure }),
  };
}
