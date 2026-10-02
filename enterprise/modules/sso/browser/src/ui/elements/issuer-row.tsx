import { CopyButton } from "@langwatch/design-system/copy-button";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The address the provider identifies itself by, a way to take it, and the
 * way into editing the identity provider settings when `onEdit` is offered.
 * The scheme is chrome (every issuer here is https), so the display drops it.
 */
import { HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Pencil } from "lucide-react";

export function IssuerRow({
  issuer,
  onEdit = null,
}: {
  issuer: string;
  onEdit?: (() => void) | null;
}) {
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
        {onEdit && (
          <Tooltip content="Edit identity provider settings">
            <IconButton
              aria-label="Edit identity provider settings"
              size="xs"
              variant="ghost"
              flexShrink={0}
              color="fg.subtle"
              onClick={onEdit}
              data-testid="identity-provider-edit"
            >
              <Pencil size={12} />
            </IconButton>
          </Tooltip>
        )}
      </HStack>
    </HStack>
  );
}
