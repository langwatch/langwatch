import { Card } from "@langwatch/design-system/card";
import { IdText } from "@langwatch/design-system/id-text";
import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Skeleton,
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
  failed,
  onRetry,
  onRemove,
}: {
  kind: OpsFeatureFlagTargetKind;
  id: string;
  target: OpsFeatureFlagTarget | undefined;
  resolving: boolean;
  /** Whether resolving the stored ids failed, so a missing target is unknown rather than absent. */
  failed: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <Card variant="panel" padding="xs" data-testid="feature-flag-target-chip">
      <HStack gap={2} align="flex-start" minWidth={0}>
        <Box flex={1} minWidth={0}>
          <ChipBody
            kind={kind}
            id={id}
            target={target}
            resolving={resolving}
            failed={failed}
            onRetry={onRetry}
          />
        </Box>
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
  failed,
  onRetry,
}: {
  kind: OpsFeatureFlagTargetKind;
  id: string;
  target: OpsFeatureFlagTarget | undefined;
  resolving: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (target) return <FeatureFlagTargetSummary target={target} />;
  if (resolving) return <Skeleton height="8" width="60%" />;
  if (failed) {
    return (
      <HStack gap={2} wrap="wrap">
        <IdText value={id} label={`${kind} ID`} />
        <Text textStyle="xs" color="fg.muted">
          Couldn't load its details
        </Text>
        <Button size="2xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </HStack>
    );
  }
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
