// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { AgentStopTarget } from "@langwatch/enterprise-governance-contract";
import { Trash2 } from "lucide-react";

import { describeStopTarget, STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";

/** The targets of a stop plan draft, each with its Remove button, off while `disabled`. */
export function StopPlanTargetList({
  targets,
  labelOf,
  onRemove,
  disabled,
}: {
  targets: readonly AgentStopTarget[];
  labelOf: (target: AgentStopTarget) => string;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <VStack align="stretch" gap={2} data-testid="stop-plan-targets">
      <Text textStyle="sm" fontWeight="semibold">
        Targets
      </Text>
      {targets.length === 0 ? (
        <Text textStyle="sm" color="fg.muted">
          No targets yet. Add one below so this agent can be stopped.
        </Text>
      ) : (
        targets.map((target, index) => (
          <HStack
            key={`${index}-${target.kind}-${describeStopTarget(target)}`}
            justify="space-between"
            data-testid="stop-plan-target"
          >
            <VStack align="start" gap={0}>
              <Text textStyle="sm">{labelOf(target)}</Text>
              <Text textStyle="xs" color="fg.muted">
                {STOP_TARGET_KIND_LABELS[target.kind]}
              </Text>
            </VStack>
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              aria-label={`Remove ${labelOf(target)}`}
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              <Trash2 size={14} />
            </Button>
          </HStack>
        ))
      )}
    </VStack>
  );
}
