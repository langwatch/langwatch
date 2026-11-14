import { Card } from "@langwatch/design-system/card";
import { IdText } from "@langwatch/design-system/id-text";
import {
  Badge,
  HStack,
  IconButton,
  Skeleton,
  Spacer,
  Text,
} from "@langwatch/design-system/primitives";
import type { OpsFeatureFlagTarget, OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";
import { X } from "lucide-react";

import { targetTitle } from "../../model/rule-targets.ts";
import { FeatureFlagTargetSummary } from "./feature-flag-target-summary.tsx";

/** One picked target in a rule, or its raw id while it resolves or when nothing answers for it. */
export function FeatureFlagTargetChip({
  kind,
  id,
  target,
  resolving,
  onRemove,
}: {
  kind: OpsFeatureFlagTargetKind;
  id: string;
  target: OpsFeatureFlagTarget | undefined;
  resolving: boolean;
  onRemove: () => void;
}) {
  return (
    <Card variant="panel" padding="xs" data-testid="feature-flag-target-chip">
      <HStack gap={2} align="flex-start">
        <ChipBody kind={kind} id={id} target={target} resolving={resolving} />
        <Spacer />
        <IconButton
          aria-label={`Remove ${target ? targetTitle(target) : id}`}
          size="2xs"
          variant="ghost"
          onClick={onRemove}
        >
          <X size={12} />
        </IconButton>
      </HStack>
    </Card>
  );
}

function ChipBody({
  kind,
  id,
  target,
  resolving,
}: {
  kind: OpsFeatureFlagTargetKind;
  id: string;
  target: OpsFeatureFlagTarget | undefined;
  resolving: boolean;
}) {
  if (target) return <FeatureFlagTargetSummary target={target} />;
  if (resolving) return <Skeleton height="8" width="60%" />;
  return (
    <HStack gap={2} wrap="wrap">
      <IdText value={id} label={`${kind} ID`} />
      <Badge size="sm" colorPalette="orange">
        not found
      </Badge>
      <Text textStyle="xs" color="fg.muted">
        No {kind} has this id
      </Text>
    </HStack>
  );
}
