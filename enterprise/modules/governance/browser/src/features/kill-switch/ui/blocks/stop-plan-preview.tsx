// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { List, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";
import { HandledErrorAlert } from "@langwatch/error-views";

import { STOP_TARGET_KIND_LABELS } from "../../model/kill-switch-copy.ts";

/**
 * The targets a stop is about to act on, as the Stop dialog shows them: loading, a failed read
 * with Retry, or the list. A failed read never reads as a plan with no targets.
 */
export function StopPlanPreview({
  targets,
  isLoading,
  error,
  onRetry,
}: {
  targets: readonly AgentStopPlanTarget[] | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load the stop plan"
        onRetry={onRetry}
      />
    );
  }
  if (isLoading || targets === null) {
    return <SkeletonRows rows={2} label="Loading the stop plan" />;
  }
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="sm" fontWeight="medium">
        {targets.length === 1 ? "This stops 1 target" : `This stops ${targets.length} targets`}
      </Text>
      <List.Root paddingStart={5} data-testid="stop-agent-targets">
        {targets.map((row) => (
          <List.Item key={row.id} textStyle="sm">
            {row.label}{" "}
            <Text as="span" color="fg.muted">
              ({STOP_TARGET_KIND_LABELS[row.target.kind]})
            </Text>
          </List.Item>
        ))}
      </List.Root>
    </VStack>
  );
}
