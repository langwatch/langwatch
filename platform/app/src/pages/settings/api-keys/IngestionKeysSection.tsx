import {
  Badge,
  Button,
  Card,
  Heading,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Radio, Trash2 } from "lucide-react";

import type { RouterOutputs } from "../../../utils/api";
import { ApiKeyLastUsedCell, ApiKeyNameCell } from "./ApiKeyTableCells";
import { apiKeyRowAnchorId } from "./apiKeyAnchor";

type IngestionKeyRow = RouterOutputs["apiKey"]["list"][number];

function isExpired(key: IngestionKeyRow): boolean {
  return Boolean(key.expiresAt && new Date(key.expiresAt) < new Date());
}

/**
 * "Ingestion keys" section of the Settings > API Keys page: write-only,
 * project-scoped credentials the `langwatch <tool>` CLI mints (ApiKey rows with
 * a non-null `ingestSourceType`). Rendered below the regular API keys table and
 * only when at least one exists. These are not created from the "Create API
 * key" drawer, so the row exposes revoke (admins only) but no permissions/scope
 * editor.
 *
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
        <Heading size="md">Ingestion keys</Heading>
        <Text fontSize="sm" color="fg.muted">
          Write-only keys scoped to one project that only ingest traces. The
          langwatch CLI mints these when you connect a tool.
        </Text>
      </VStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Key</Table.ColumnHeader>
                <Table.ColumnHeader>Source</Table.ColumnHeader>
                <Table.ColumnHeader>Created from</Table.ColumnHeader>
                <Table.ColumnHeader>Last used</Table.ColumnHeader>
                <Table.ColumnHeader>Created</Table.ColumnHeader>
                <Table.ColumnHeader width="60px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {keys.map((apiKey) => (
                <Table.Row key={apiKey.id} id={apiKeyRowAnchorId(apiKey.id)}>
                  <Table.Cell>
                    <ApiKeyNameCell
                      name={apiKey.name}
                      description={apiKey.description}
                      secret={{
                        display: `ik-lw-${apiKey.lookupIdPrefix}…`,
                        copyValue: `ik-lw-${apiKey.lookupIdPrefix}`,
                        copyLabel: `Copy the key identifier for ${apiKey.name}`,
                        copiedTitle: "Key identifier copied",
                      }}
                      isExpired={isExpired(apiKey)}
                      icon={<Radio size={14} aria-hidden />}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" variant="subtle" colorPalette="blue">
                      {apiKey.ingestSourceType}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {apiKey.createdByDeviceLabel ? (
                      <Text fontSize="sm">{apiKey.createdByDeviceLabel}</Text>
                    ) : (
                      <Text fontSize="sm" color="fg.muted">
                        Unknown device
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <ApiKeyLastUsedCell lastUsedAt={apiKey.lastUsedAt} />
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">
                      {new Date(apiKey.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {/* Ingestion keys carry no role bindings to edit; revoke
                        only, gated to admins. */}
                    {isAdmin && (
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label={`Revoke ingestion key ${apiKey.name}`}
                        onClick={() => onRevoke(apiKey.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
