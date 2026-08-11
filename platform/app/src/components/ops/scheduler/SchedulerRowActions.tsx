import { IconButton, Menu, Portal } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import type { SchedulerJobStatus } from "./schedulerStatus";

type PendingAction = "pause" | "resume" | "clear" | "run" | null;

/**
 * Per-row controls (ADR-091), following row-actions-overflow-menu.
 *
 * Every confirmation names the PROJECT, not its identifier: these controls are
 * cross-tenant, and the realistic failure is not the wrong action but the right
 * action on the row above the one you meant.
 */
export function SchedulerRowActions({
  scheduleId,
  targetId,
  projectName,
  status,
  canClearSlot,
  onDone,
}: {
  scheduleId: string;
  targetId: string;
  /** Resolved project NAME, or null when it could not be resolved. */
  projectName: string | null;
  status: SchedulerJobStatus;
  /** Only true once the slot has been held past the staleness threshold. */
  canClearSlot: boolean;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);

  const settle = (title: string) => ({
    onSuccess: () => {
      toaster.create({ title, type: "success" });
      setPending(null);
      onDone();
    },
    onError: (error: unknown) => {
      showErrorToast({ error, fallbackTitle: "That didn't work" });
      setPending(null);
    },
  });

  const setActive = api.ops.setScheduleActive.useMutation(
    settle("Schedule updated"),
  );
  const clearSlot = api.ops.clearScheduleSlot.useMutation(
    settle("Slot cleared"),
  );
  const runNow = api.ops.runScheduleNow.useMutation(settle("Run requested"));

  const isPaused = status === "paused";

  // ADR-091's one human guard: the risk here is the right action on the wrong
  // tenant, and a ksuid an operator cannot verify at a glance does not guard
  // against that. With no resolved name, run-now — the only control that can
  // deliver something to a customer — is withheld rather than confirmed
  // against an identifier nobody can read.
  const tenant = projectName;
  const canRunNow = tenant !== null;

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            aria-label="Schedule actions"
            variant="ghost"
            size="xs"
            data-testid="scheduler-row-actions"
          >
            <MoreVertical size={14} />
          </IconButton>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content>
              {canRunNow && (
                <Menu.Item value="run" onClick={() => setPending("run")}>
                  Run now
                </Menu.Item>
              )}
              <Menu.Item
                value="active"
                onClick={() => setPending(isPaused ? "resume" : "pause")}
              >
                {isPaused ? "Resume" : "Pause"}
              </Menu.Item>
              {canClearSlot && (
                <Menu.Item value="clear" onClick={() => setPending("clear")}>
                  Clear stuck slot
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <ConfirmDialog
        open={pending === "run"}
        onClose={() => setPending(null)}
        onConfirm={() => runNow.mutate({ scheduleId })}
        isLoading={runNow.isPending}
        title="Run this schedule now?"
        description={`${targetId} will run for ${tenant} as soon as a worker picks it up, exactly as a scheduled run would. Anything it delivers goes to that project.`}
      />

      <ConfirmDialog
        open={pending === "pause"}
        onClose={() => setPending(null)}
        onConfirm={() => setActive.mutate({ scheduleId, active: false })}
        isLoading={setActive.isPending}
        title="Pause this schedule?"
        description={`${targetId} will stop running for ${tenant ?? "this project"} until you resume it. A run already in progress continues — pausing does not cancel it.`}
      />

      <ConfirmDialog
        open={pending === "resume"}
        onClose={() => setPending(null)}
        onConfirm={() => setActive.mutate({ scheduleId, active: true })}
        isLoading={setActive.isPending}
        title="Resume this schedule?"
        description={`${targetId} will go back on the calendar for ${tenant ?? "this project"} and run at its next scheduled time.`}
      />

      <ConfirmDialog
        open={pending === "clear"}
        onClose={() => setPending(null)}
        onConfirm={() => clearSlot.mutate({ scheduleId })}
        isLoading={clearSlot.isPending}
        title="Clear this stuck slot?"
        description={`This releases the run ${targetId} has been holding for ${tenant ?? "this project"} so it can be picked up again. If the original worker is somehow still alive, the slot could be worked twice.`}
      />
    </>
  );
}
