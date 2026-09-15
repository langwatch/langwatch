/**
 * The API keys issued to THIS person on this organization, never the whole
 * roster. Read-only: issuing and revoking stay on the API Keys page, which
 * already carries the scopes and confirmations that go with them.
 */

import { toEpochMs } from "@langwatch/time";
import { Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { formatRelativeTime } from "../../model/relative-time.ts";

/** The words the API Keys page itself uses for a permission mode. */
function permissionLabel(mode: string): string {
  if (mode === "readonly") return "Read only";
  if (mode === "restricted") return "Restricted";
  return "Full access";
}

export function PersonalApiKeysSummary() {
  const host = usePersonalWorkspaceHost();
  const organizationId = host.organization()?.id ?? null;
  const userId = host.currentUser()?.id ?? null;

  const keys = api.apiKey.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );

  useEffect(() => {
    if (keys.isError) {
      host.failed({ error: keys.error, fallbackTitle: "Couldn't read your API keys" });
    }
  }, [keys.isError, keys.error, host]);

  if (!organizationId) return null;

  const mine = (keys.data ?? []).filter(
    (key) => key.userId === userId && key.revokedAt === null,
  );

  return (
    <VStack align="stretch" gap={3} width="full" data-testid="personal-api-keys-summary">
      <HStack justify="space-between" width="full">
        <Text fontWeight={600}>Your API keys</Text>
        <Button asChild size="xs" variant="outline" data-testid="api-keys-manage">
          <a href="/settings/api-keys">Manage API keys</a>
        </Button>
      </HStack>

      {mine.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No key has been issued to you yet.
        </Text>
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {mine.map((key) => (
            <HStack key={key.id} width="full" gap={2} data-testid="personal-api-key-row">
              <Text fontSize="sm" fontWeight={500} truncate>
                {key.name}
              </Text>
              <Badge variant="surface" size="sm" colorPalette="gray">
                {permissionLabel(key.permissionMode)}
              </Badge>
              <Text fontSize="xs" color="fg.muted">
                Last used{" "}
                {formatRelativeTime(key.lastUsedAt ? toEpochMs(key.lastUsedAt) : null)}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
