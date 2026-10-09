import { Stack, Text } from "@langwatch/design-system/primitives";
import { readableDate } from "@langwatch/time";

import { statusTone } from "../../model/upgrade-labels.ts";
import type { UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "./upgrade-status-badge.tsx";

/** An old serving process by role, release (else image) and when it was last seen. */
function waitingWriterLabel(writer: UpgradeStepView["waitingOn"][number]): string {
  const name = writer.release ?? writer.image;
  if (!writer.lastSeenAt) return `${writer.role} (${name})`;
  return `${writer.role} (${name}, last seen ${readableDate(writer.lastSeenAt).toLocaleString()})`;
}

/** Progress from the checkpoint, else the old processes the step waits on, else nothing. */
function stepDetail(step: UpgradeStepView): string | null {
  if (step.progress) {
    const { done, total } = step.progress;
    return `${Math.floor((done / total) * 100)}% · ${done} of ${total}`;
  }
  if (step.waitingOn.length === 0) return null;
  return `Waiting on ${step.waitingOn.map(waitingWriterLabel).join(", ")}`;
}

/** The status badge, with progress or what the step waits on as one muted line under it. */
export function UpgradeStepState({ step }: { step: UpgradeStepView }) {
  const detail = stepDetail(step);
  return (
    <Stack gap={1} align="start">
      <UpgradeStatusBadge label={{ label: step.statusLabel, tone: statusTone(step.status) }} />
      {detail && (
        <Text textStyle="xs" color="fg.muted">
          {detail}
        </Text>
      )}
    </Stack>
  );
}
