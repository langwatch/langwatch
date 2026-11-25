/**
 * The attack a red team scenario runs, read-only: strategy, attack goal, OWASP categories and
 * turn budget. The template that created the scenario owns them.
 * @see modules/scenario/specs/red-team-scenario.feature
 */

import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { RedTeamConfig, RedTeamStrategy } from "@langwatch/scenario-contract";
import type { ReactNode } from "react";

import { owaspCategoryLabel } from "../../../../model/owasp-category.ts";

const STRATEGY_LABELS: Record<RedTeamStrategy, string> = {
  crescendo: "Crescendo",
  goat: "GOAT",
};

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={0.5}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

export function RedTeamConfigBlock({ config }: { config: RedTeamConfig }) {
  return (
    <VStack
      align="stretch"
      gap={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      padding={3}
      data-testid="case-red-team-config"
      aria-label="Red team attack"
    >
      <Text fontSize="sm" fontWeight="medium">
        Red team attack
      </Text>
      <ConfigRow label="Attack goal">
        <Text fontSize="sm">{config.attackGoal}</Text>
      </ConfigRow>
      <ConfigRow label="OWASP categories">
        <HStack gap={1.5} flexWrap="wrap">
          {config.owaspIds.map((id) => (
            <Badge key={id} size="sm" variant="outline">
              {owaspCategoryLabel({ id })}
            </Badge>
          ))}
        </HStack>
      </ConfigRow>
      <HStack gap={6}>
        <ConfigRow label="Strategy">
          <Text fontSize="sm">{STRATEGY_LABELS[config.strategy]}</Text>
        </ConfigRow>
        <ConfigRow label="Max turns">
          <Text fontSize="sm">{config.maxTurns}</Text>
        </ConfigRow>
      </HStack>
    </VStack>
  );
}
