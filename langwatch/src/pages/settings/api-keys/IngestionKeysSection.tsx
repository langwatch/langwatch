import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Radio, Trash2 } from "lucide-react";

import { Tooltip } from "../../../components/ui/tooltip";
import type { RouterOutputs } from "../../../utils/api";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";

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
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Name</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Secret Key</Table.ColumnHeader>
                <Table.ColumnHeader>Created</Table.ColumnHeader>
                <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                <Table.ColumnHeader>Source</Table.ColumnHeader>
                <Table.ColumnHeader>Created from</Table.ColumnHeader>
                <Table.ColumnHeader width="100px"></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {keys.map((apiKey) => (
                <Table.Row key={apiKey.id}>
                  <Table.Cell>
                    <HStack align="start">
                      <Box paddingTop={1}>
                        <Radio size={14} />
                      </Box>
                      <VStack align="start" gap={0}>
                        <Text>{apiKey.name}</Text>
                        {apiKey.description && (
                          <Text fontSize="xs" color="fg.muted">
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
                    <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
                      ik-lw-{apiKey.lookupIdPrefix}…
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {new Date(apiKey.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Table.Cell>
                  <Table.Cell>
                    {apiKey.lastUsedAt ? (
                      <Tooltip
                        content={new Date(apiKey.lastUsedAt).toISOString()}
                      >
                        <Text
                          cursor="help"
                          tabIndex={0}
                          aria-label={`Last used at ${new Date(apiKey.lastUsedAt).toISOString()}`}
                        >
                          {formatTimeAgo(new Date(apiKey.lastUsedAt).getTime())}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text fontSize="sm" color="fg.muted">
                        Never
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" colorPalette="blue">
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
