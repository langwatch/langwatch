import { CopyButton } from "@langwatch/design-system/copy-button";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The address the provider identifies itself by, and a way to take it. The
 * scheme is chrome rather than information (every issuer here is https), so it
 * is dropped from the display; the whole address is on the hover and the copy.
 */
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";

export function IssuerRow({ issuer }: { issuer: string }) {
  return (
    <HStack gap={2} align="start" width="full" data-testid="connection-issuer">
      <VStack align="start" gap={0} minWidth="7rem" flexShrink={0}>
        <Text fontSize="sm" color="fg.muted">
          Issuer
        </Text>
        <Text fontSize="xs" color="fg.subtle">
          The address your provider identifies itself by.
        </Text>
      </VStack>
      <HStack gap={1} minWidth={0} maxWidth="full">
        <Text
          fontFamily="mono"
          fontSize="xs"
          color="fg.muted"
          truncate
          maxWidth="full"
          title={issuer}
        >
          {issuer.replace(/^https?:\/\//, "")}
        </Text>
        <CopyButton
          value={issuer}
          label="Issuer address"
          aria-label="Copy issuer address"
          size="xs"
          flexShrink={0}
          color="fg.subtle"
        />
      </HStack>
    </HStack>
  );
}
