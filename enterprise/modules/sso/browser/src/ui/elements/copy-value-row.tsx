// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One fact to publish elsewhere: what it is called, what it says, and a way
 * to take it without retyping it. Every value here is meant to be pasted
 * into somebody else's administration screen, so none of it is truncated.
 */
import { HStack, Text } from "@chakra-ui/react";
import { CopyButton } from "@langwatch/design-system/copy-button";

export function CopyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={2} align="start" width="full" data-testid="copy-value-row">
      <Text fontSize="xs" color="fg.muted" minWidth="7rem" flexShrink={0}>
        {label}
      </Text>
      <Text fontSize="xs" fontFamily="mono" wordBreak="break-all" flex={1}>
        {value}
      </Text>
      <CopyButton value={value} label={label} aria-label={`Copy ${label}`} />
    </HStack>
  );
}
