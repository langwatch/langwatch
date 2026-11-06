/**
 * A key opened again: its settings, read-only, and what may be done with it next. The secret
 * is never here; it was shown once, at minting or rotation.
 * Spec: specs/api-keys/api-key-rotation.feature
 */
import type { ApiKeyListEntry } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { Drawer } from "@langwatch/design-system/drawer";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { IdText } from "@langwatch/design-system/id-text";
import { Badge, Box, Grid, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { maskedKeyHint, restrictedCategoryAccess } from "../../model/api-key-details.ts";

type ApiKeyRow = WireOf<ApiKeyListEntry>;

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text as="dt" textStyle="label" color="fg.muted">
        {label}
      </Text>
      <Box as="dd" minWidth={0}>
        {children}
      </Box>
    </>
  );
}

function PermissionsDetail({ apiKey }: { apiKey: ApiKeyRow }) {
  if (apiKey.permissionMode !== "restricted") {
    return (
      <VStack align="start" gap={1}>
        <Badge size="sm" colorPalette="green">
          All
        </Badge>
        <Text textStyle="caption" color="fg.muted">
          Everything its owner may do at its scopes.
        </Text>
      </VStack>
    );
  }
  const categories = restrictedCategoryAccess({ apiKey });

  return (
    <VStack align="start" gap={1}>
      <Badge size="sm" colorPalette="orange">
        Restricted
      </Badge>
      {categories.length === 0 ? (
        <EmptyValue label="No permissions" />
      ) : (
        <VStack
          as="ul"
          align="start"
          gap={0}
          listStyleType="none"
          data-testid="api-key-details-permissions"
        >
          {categories.map((category) => (
            <Text as="li" key={category.key} textStyle="bodySm">
              {category.label}: {category.access}
            </Text>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function OwnerDetail({ apiKey }: { apiKey: ApiKeyRow }) {
  return (
    <VStack align="start" gap={0} minWidth={0}>
      {apiKey.userId ? (
        <Text textStyle="bodySm" truncate maxWidth="full">
          {apiKey.userEmail ?? apiKey.userName ?? <EmptyValue label="No owner" />}
        </Text>
      ) : (
        <EmptyValue label="No owner" />
      )}
      <Text textStyle="caption" color="fg.muted">
        {apiKey.userId ? "Personal key" : "Service key"}
      </Text>
    </VStack>
  );
}

export function ApiKeyDetailsDrawer({
  apiKey,
  canModify,
  onClose,
  onEdit,
  onRotate,
  onRevoke,
}: {
  apiKey: ApiKeyRow | null;
  /** Owner or admin; everyone else may only read. */
  canModify: (apiKey: ApiKeyRow) => boolean;
  onClose: () => void;
  onEdit: (apiKey: ApiKeyRow) => void;
  onRotate: (apiKey: ApiKeyRow) => void;
  onRevoke: (apiKeyId: string) => void;
}) {
  return (
    <Drawer
      size="md"
      open={!!apiKey}
      onClose={onClose}
      title={apiKey?.name ?? "API key"}
      footer={
        apiKey && canModify(apiKey)
          ? {
              destructiveAction: {
                label: "Revoke",
                onClick: () => onRevoke(apiKey.id),
                "data-testid": "api-key-details-revoke",
              },
              secondaryAction: {
                label: "Rotate",
                icon: <RefreshCw size={14} />,
                onClick: () => onRotate(apiKey),
                "data-testid": "api-key-details-rotate",
              },
              primaryAction: {
                label: "Edit",
                onClick: () => onEdit(apiKey),
                "data-testid": "api-key-details-edit",
              },
            }
          : void 0
      }
    >
      {apiKey && (
        <VStack align="stretch" gap={5} data-testid="api-key-details">
          {apiKey.description && <Text color="fg.muted">{apiKey.description}</Text>}
          <Grid
            as="dl"
            templateColumns="max-content 1fr"
            columnGap={6}
            rowGap={4}
            alignItems="start"
          >
            <DetailRow label="Secret key">
              <VStack align="start" gap={0}>
                <IdText value={maskedKeyHint(apiKey)} label="secret key prefix" copyable={false} />
                <Text textStyle="caption" color="fg.muted">
                  Shown once when it was created or rotated. Rotate the key to get a new one.
                </Text>
              </VStack>
            </DetailRow>
            <DetailRow label="Owner">
              <OwnerDetail apiKey={apiKey} />
            </DetailRow>
            <DetailRow label="Scope">
              <ProviderScopeChips
                size="xs"
                scopes={apiKey.grants.map((grant) => ({
                  scopeType: grant.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
                  scopeId: grant.scopeId,
                  name: grant.scopeName ?? undefined,
                }))}
              />
            </DetailRow>
            <DetailRow label="Permissions">
              <PermissionsDetail apiKey={apiKey} />
            </DetailRow>
            <DetailRow label="Expires">
              {apiKey.expiresAt ? (
                <FormattedDate value={apiKey.expiresAt} display="date" />
              ) : (
                <Text textStyle="bodySm">Never</Text>
              )}
            </DetailRow>
            <DetailRow label="Created">
              <HStack gap={1} wrap="wrap">
                <FormattedDate value={apiKey.createdAt} display="date" />
                {apiKey.createdByUserName && (
                  <Text textStyle="bodySm" color="fg.muted">
                    by {apiKey.createdByUserName}
                  </Text>
                )}
              </HStack>
            </DetailRow>
            <DetailRow label="Last used">
              {apiKey.lastUsedAt ? (
                <FormattedDate value={apiKey.lastUsedAt} display="relative" />
              ) : (
                <EmptyValue label="Never used" />
              )}
            </DetailRow>
          </Grid>
        </VStack>
      )}
    </Drawer>
  );
}
