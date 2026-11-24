import { Stack, Text } from "@langwatch/design-system/primitives";
import { nowEpochMs, readableDate } from "@langwatch/time";

import { oldWritersGraceLine, statusTone } from "../../model/upgrade-labels.ts";
import type { UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "./upgrade-status-badge.tsx";

/** An old serving process by role, release (else image) and when it was last seen. */
function waitingWriterLabel(writer: UpgradeStepView["waitingOn"][number]): string {
  const name = writer.release ?? writer.image;
  if (!writer.lastSeenAt) return `${writer.role} (${name})`;
  return `${writer.role} (${name}, last seen ${readableDate(writer.lastSeenAt).toLocaleString()})`;
}

/** Progress from the checkpoint, else the old processes and the grace the step waits on. */
function stepDetails(step: UpgradeStepView): string[] {
  if (step.progress) {
    const { done, total } = step.progress;
    return [`${Math.floor((done / total) * 100)}% · ${done} of ${total}`];
  }
  const details: string[] = [];
  if (step.waitingOn.length > 0) {
    details.push(`Waiting on ${step.waitingOn.map(waitingWriterLabel).join(", ")}`);
  }
  if (step.oldWritersGraceEndsAt) {
    details.push(oldWritersGraceLine({ endsAt: step.oldWritersGraceEndsAt, nowMs: nowEpochMs() }));
  }
  return details;
}

/** The status badge, with progress or what the step waits on as muted lines under it. */
export function UpgradeStepState({ step }: { step: UpgradeStepView }) {
  return (
    <Stack gap={1} align="start">
      <UpgradeStatusBadge label={{ label: step.statusLabel, tone: statusTone(step.status) }} />
      {stepDetails(step).map((detail) => (
        <Text key={detail} textStyle="xs" color="fg.muted">
          {detail}
        </Text>
      ))}
    </Stack>
  );
}
