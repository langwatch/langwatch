import type { ApiKeyListEntry } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SectionTitle } from "@langwatch/design-system/typography";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { Radio } from "lucide-react";

import { apiKeyRowAnchorId } from "../../model/api-key-anchor.ts";

/** A key as the browser holds one: the wire carries its instants as ISO strings. */
type IngestionKeyRow = WireOf<ApiKeyListEntry>;

function isExpired(key: IngestionKeyRow): boolean {
  return Boolean(key.expiresAt && toEpochMs(key.expiresAt) < nowInstant().epochMilliseconds);
}

/**
 * "Ingestion keys" section of the Settings > API Keys page: write-only, project-scoped
 * credentials the `langwatch <tool>` CLI mints.
 * Spec: specs/api-keys/unified-api-keys.feature
 */
export function IngestionKeysSection({
  keys,
  isAdmin,
  onRevoke,
}: {
  keys: IngestionKeyRow[];
  isAdmin: boolean;
  onRevoke: (apiKeyId: string) => void;
}) {
  if (keys.length === 0) return null;

  return (
    <VStack gap={4} width="full" align="start">
      <VStack gap={1} align="start">
        <SectionTitle>Ingestion keys</SectionTitle>
        <Text textStyle="bodySm" color="fg.muted">
          Write-only keys scoped to one project that only ingest traces. The langwatch CLI mints
          these when you connect a tool.
        </Text>
      </VStack>

      <ListTable scroll="x" scrollLabel="Ingestion keys">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Secret key</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Created</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Source</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Created from</ListTable.ColumnHeader>
            <ListTable.ActionHeader />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {keys.map((apiKey) => (
            <ListTable.Row key={apiKey.id} id={apiKeyRowAnchorId(apiKey.id)}>
              <ListTable.Cell>
                <HStack align="start">
                  <Box paddingTop={1}>
                    <Radio size={14} />
                  </Box>
                  <VStack align="start" gap={0}>
                    <Text>{apiKey.name}</Text>
                    {apiKey.description && (
                      <Text textStyle="caption" color="fg.muted">
                        {apiKey.description}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              </ListTable.Cell>
              <ListTable.Cell>
                {isExpired(apiKey) ? (
                  <Badge size="sm" colorPalette="red">
                    Expired
                  </Badge>
                ) : (
                  <Badge size="sm" colorPalette="green">
                    Active
                  </Badge>
                )}
              </ListTable.Cell>
              <ListTable.Cell>
                <IdText
                  value={`ik-lw-${apiKey.lookupIdPrefix}…`}
                  label="secret key prefix"
                  copyable={false}
                />
              </ListTable.Cell>
              <ListTable.Cell>
                <FormattedDate value={apiKey.createdAt} display="date" />
              </ListTable.Cell>
              <ListTable.Cell nowrap>
                {apiKey.lastUsedAt ? (
                  <FormattedDate value={apiKey.lastUsedAt} display="relative" />
                ) : (
                  <EmptyValue label="Never used" />
                )}
              </ListTable.Cell>
              <ListTable.Cell>
                <Badge size="sm" colorPalette="blue">
                  {apiKey.ingestSourceType}
                </Badge>
              </ListTable.Cell>
              <ListTable.Cell>
                {apiKey.createdByDeviceLabel ? (
                  <Text textStyle="bodySm">{apiKey.createdByDeviceLabel}</Text>
                ) : (
                  <EmptyValue label="Unknown device" />
                )}
              </ListTable.Cell>
              <ListTable.ActionCell>
                {/* Ingestion keys carry no role bindings to edit; revoke
                        only, gated to admins. */}
                {isAdmin && (
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Actions for ingestion key ${apiKey.name}`}
                      >
                        <MoreVerticalIcon size={14} />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content>
                      <Menu.Item value="revoke" color="red.fg" onClick={() => onRevoke(apiKey.id)}>
                        Revoke
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                )}
              </ListTable.ActionCell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </VStack>
  );
}
