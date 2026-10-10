/**
 * What the run dialog says when a chosen agent has no process behind it.
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Alert } from "@langwatch/design-system/primitives";

import type { TargetValue } from "../../../../model/scenario-target.ts";
import { offlineTargetMessage, offlineTargetsOf } from "./offline-targets.ts";
import type { RunDialogAgent } from "./run-target-picker.tsx";

export function OfflineTargetsNotice({
  agents,
  targets,
}: {
  agents: readonly RunDialogAgent[];
  /** The targets the run goes against: one, or one per comparison row. */
  targets: readonly TargetValue[];
}) {
  const offline = offlineTargetsOf({ agents, targets });
  if (offline.length === 0) return null;

  return (
    <Alert.Root status="warning" size="sm" data-testid="run-dialog-offline-targets">
      <Alert.Indicator />
      <Alert.Content>
        {offline.map((target) => (
          <Alert.Description key={target.id}>{offlineTargetMessage(target)}</Alert.Description>
        ))}
      </Alert.Content>
    </Alert.Root>
  );
}
