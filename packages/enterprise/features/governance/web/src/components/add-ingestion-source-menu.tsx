// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HStack, Spacer, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { Lock } from "lucide-react";
// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";
import {
  gatedSourceTypeOptions,
  groupForMode,
  SOURCE_GROUP_META,
  type SourceGroup,
  type SourceType,
} from "../ingestion-source-catalog";

/**
 * The Add source entry point: a menu of every supported ingestion-source
 * type, each with its vendor mark, grouped under the two customer-facing
 * headings from the catalog. Same shape as the model-providers
 * AddModelProviderMenu so the two "add a thing by vendor" surfaces feel like
 * one product.
 *
 * Plan-locked types render inert with the plan that unlocks them — they get
 * no click handler at all, so a locked type cannot be picked no matter what
 * the pointer does. `disabledReason` makes the whole trigger inert with the
 * reason on hover (used when a non-enterprise org is at its source cap), and
 * mounts no menu, so adding can never open onto a list that leads nowhere.
 */
export function AddIngestionSourceMenu({
  children,
  isEnterprise,
  disabledReason,
  hint,
  onPick,
  renderSourceIcon,
}: {
  children: React.ReactNode;
  isEnterprise: boolean;
  disabledReason?: string;
  /** Hover hint on the (enabled) trigger, e.g. the plan's source allowance. */
  hint?: string;
  onPick: (sourceType: SourceType) => void;
  renderSourceIcon?: (sourceType: SourceType, size: string) => React.ReactNode;
}) {
  if (disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <TriggerAnchor>{children}</TriggerAnchor>
      </Tooltip>
    );
  }

  const options = gatedSourceTypeOptions({ isEnterprise });
  const groups: SourceGroup[] = ["realtime", "scheduled"];

  return (
    <Menu.Root>
      <Tooltip content={hint} disabled={!hint}>
        <TriggerAnchor>
          <Menu.Trigger asChild>{children}</Menu.Trigger>
        </TriggerAnchor>
      </Tooltip>
      <Menu.Content>
        {groups.map((group) => (
          <Menu.ItemGroup key={group} title={SOURCE_GROUP_META[group].title}>
            {options
              .filter((option) => groupForMode(option.mode) === group)
              .map((option) =>
                option.locked ? (
                  <Menu.Item key={option.value} value={option.value} disabled>
                    <HStack gap={3} width="full">
                      {renderSourceIcon?.(option.value, "20px")}
                      <Text>{option.label}</Text>
                      <Spacer />
                      <HStack gap={1} color="fg.muted">
                        <Lock size={12} />
                        <Text fontSize="xs">Enterprise</Text>
                      </HStack>
                    </HStack>
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    key={option.value}
                    value={option.value}
                    onClick={() => onPick(option.value)}
                  >
                    <HStack gap={3}>
                      {renderSourceIcon?.(option.value, "20px")}
                      <Text>{option.label}</Text>
                    </HStack>
                  </Menu.Item>
                ),
              )}
          </Menu.ItemGroup>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
