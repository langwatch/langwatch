/**
 * What the run dialog says when a chosen agent has no process behind it.
 *
 * The run is refused when it starts, so the dialog says it before the person
 * presses Run rather than after every scenario failed.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Text, VStack } from "@chakra-ui/react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { offlineTargetMessage, offlineTargetsOf } from "./offline-targets";
import type { RunDialogAgent } from "./RunTargetPicker";

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
    <VStack
      align="stretch"
      gap={1}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      paddingX={3}
      paddingY={2}
      data-testid="run-dialog-offline-targets"
    >
      {offline.map((target) => (
        <Text key={target.id} fontSize="12px">
          {offlineTargetMessage(target)}
        </Text>
      ))}
    </VStack>
  );
}
