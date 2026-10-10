import type { ApiKeyListEntry } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  HStack,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SectionTitle } from "@langwatch/design-system/typography";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { MoreVertical, Radio } from "lucide-react";

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

      <ListTable containerProps={{ overflowX: "auto" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Name</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
            <Table.ColumnHeader>Secret key</Table.ColumnHeader>
            <Table.ColumnHeader>Created</Table.ColumnHeader>
            <Table.ColumnHeader>Last used</Table.ColumnHeader>
            <Table.ColumnHeader>Source</Table.ColumnHeader>
            <Table.ColumnHeader>Created from</Table.ColumnHeader>
            <ListTable.ActionHeader />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {keys.map((apiKey) => (
            <Table.Row key={apiKey.id} id={apiKeyRowAnchorId(apiKey.id)}>
              <Table.Cell>
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
              </Table.Cell>
              <Table.Cell>
                {isExpired(apiKey) ? (
                  <Badge size="sm" colorPalette="red">
                    Expired
                  </Badge>
                ) : (
                  <Badge size="sm" colorPalette="green">
                    Active
                  </Badge>
                )}
              </Table.Cell>
              <Table.Cell>
                <IdText
                  value={`ik-lw-${apiKey.lookupIdPrefix}…`}
                  label="secret key prefix"
                  copyable={false}
                />
              </Table.Cell>
              <Table.Cell>
                <FormattedDate value={apiKey.createdAt} display="date" />
              </Table.Cell>
              <Table.Cell whiteSpace="nowrap">
                {apiKey.lastUsedAt ? (
                  <FormattedDate value={apiKey.lastUsedAt} display="relative" />
                ) : (
                  <EmptyValue label="Never used" />
                )}
              </Table.Cell>
              <Table.Cell>
                <Badge size="sm" colorPalette="blue">
                  {apiKey.ingestSourceType}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                {apiKey.createdByDeviceLabel ? (
                  <Text textStyle="bodySm">{apiKey.createdByDeviceLabel}</Text>
                ) : (
                  <EmptyValue label="Unknown device" />
                )}
              </Table.Cell>
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
                        <MoreVertical size={14} />
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
            </Table.Row>
          ))}
        </Table.Body>
      </ListTable>
    </VStack>
  );
}
