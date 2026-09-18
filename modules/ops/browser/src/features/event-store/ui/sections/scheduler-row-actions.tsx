import { Field, IconButton, Input, Menu, Portal, Text } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import { canRunNow, type SchedulerJobStatus } from "../../model/scheduler-presentation.ts";
type PendingAction = "pause" | "resume" | "clear" | "run" | null;

/** Per-row controls (ADR-091). Confirmations name PROJECT (cross-tenant; risk is
 * right action on wrong row). */
export function SchedulerRowActions({
  scheduleId,
  targetType,
  targetId,
  projectName,
  status,
  canClearSlot,
  onDone,
}: {
  scheduleId: string;
  /** What kind of thing is scheduled, e.g. "briefing". Used as the copy's noun. */
  targetType: string;
  targetId: string;
  /** Resolved project NAME, or null when it could not be resolved. */
  projectName: string | null;
  status: SchedulerJobStatus;
  /** Only true once the slot has been held past the staleness threshold. */
  canClearSlot: boolean;
  onDone: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
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

  const setActive = api.ops.setScheduleActive.useMutation(settle("Schedule updated"));
  const clearSlot = api.ops.clearScheduleSlot.useMutation(settle("Slot cleared"));
  const runNow = api.ops.runScheduleNow.useMutation(settle("Run requested"));

  const isPaused = status === "paused";

  // Hidden rather than offered-and-refused, the same rule that hides mutations
  // from a view-only operator. `canRunNow` carries what each refusal costs.
  const tenant = projectName;
  const isRunNowOffered = canRunNow({ projectName, status });

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
              {isRunNowOffered && (
                <Menu.Item value="run" onClick={() => setPending("run")}>
                  Run now
                </Menu.Item>
              )}
              <Menu.Item value="active" onClick={() => setPending(isPaused ? "resume" : "pause")}>
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

      <SchedulerConfirmations
        pending={pending}
        onClose={() => setPending(null)}
        targetType={targetType}
        targetId={targetId}
        tenant={tenant}
        onRunNow={() => runNow.mutate({ scheduleId })}
        onSetActive={(active) => setActive.mutate({ scheduleId, active })}
        onClearSlot={() => clearSlot.mutate({ scheduleId })}
        busy={runNow.isPending || setActive.isPending || clearSlot.isPending}
      />
    </>
  );
}

/** Confirmations use target TYPE not ksuid (unreadable ID isn't checkable in
 * sentence); full ID shown separately for verification. */
function SchedulerConfirmations({
  pending,
  onClose,
  targetType,
  targetId,
  tenant,
  onRunNow,
  onSetActive,
  onClearSlot,
  busy,
}: {
  pending: PendingAction;
  onClose: () => void;
  targetType: string;
  targetId: string;
  tenant: string | null;
  onRunNow: () => void;
  onSetActive: (active: boolean) => void;
  onClearSlot: () => void;
  busy: boolean;
}) {
  // Run-now is the only control that can deliver something to a customer, so it
  // is the only one gated on a resolved name — `canRunNow` withholds it
  // otherwise, which is why this falls back for the reversible controls only.
  const project = tenant ?? "this project";
  const target = `this ${targetType}`;

  return (
    <>
      <RunNowConfirmation
        open={pending === "run"}
        onClose={onClose}
        onConfirm={onRunNow}
        busy={busy}
        targetType={targetType}
        targetId={targetId}
        project={project}
      />

      <ConfirmDialog
        open={pending === "pause"}
        onClose={onClose}
        onConfirm={() => onSetActive(false)}
        isLoading={busy}
        title="Pause this schedule?"
        description={`${target} will stop running for ${project} until you resume it. A run already in progress continues. Pausing does not cancel it.`}
      >
        <TargetIdentity targetId={targetId} />
      </ConfirmDialog>

      <ConfirmDialog
        open={pending === "resume"}
        onClose={onClose}
        onConfirm={() => onSetActive(true)}
        isLoading={busy}
        title="Resume this schedule?"
        description={`${target} will go back on the calendar for ${project} and run at its next scheduled time.`}
      >
        <TargetIdentity targetId={targetId} />
      </ConfirmDialog>

      <ConfirmDialog
        open={pending === "clear"}
        onClose={onClose}
        onConfirm={onClearSlot}
        isLoading={busy}
        title="Clear this stuck slot?"
        description={`This releases the run ${target} has been holding for ${project} so it can be picked up again. If the original worker is somehow still alive, the slot could be worked twice.`}
      >
        <TargetIdentity targetId={targetId} />
      </ConfirmDialog>
    </>
  );
}

/** The identifier, shown where it can be compared rather than read as prose. */
function TargetIdentity({ targetId }: { targetId: string }) {
  return (
    <Text textStyle="xs" fontFamily="mono" color="fg.muted" marginTop={2} wordBreak="break-all">
      {targetId}
    </Text>
  );
}

/** Confirms by typed project name (irreversible, affects customers). Typing is the
 * real check—prevents right action on wrong tenant. */
function RunNowConfirmation({
  open,
  onClose,
  onConfirm,
  busy,
  targetType,
  targetId,
  project,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  targetType: string;
  targetId: string;
  project: string;
}) {
  const [typed, setTyped] = useState("");

  // Clear on every close, not just on Cancel. A CONFIRMED run closes through
  // the parent's success handler rather than through `onClose`, so resetting
  // there only would leave the typed name sitting in the box: reopening the
  // same row would find Confirm already enabled, and one click would send a
  // second real report. Keying off `open` covers both exits.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const close = () => {
    setTyped("");
    onClose();
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={close}
      onConfirm={onConfirm}
      isLoading={busy}
      confirmDisabled={typed.trim() !== project}
      title="Run this schedule now?"
      description={`This ${targetType} will run for ${project} as soon as a worker picks it up, exactly as a scheduled run would. Anything it delivers goes to that project.`}
    >
      <TargetIdentity targetId={targetId} />
      <Field.Root marginTop={4}>
        <Field.Label textStyle="xs">
          Type <strong>{project}</strong> to confirm
        </Field.Label>
        <Input
          size="sm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={project}
          autoComplete="off"
        />
      </Field.Root>
    </ConfirmDialog>
  );
}
