/**
 * The API keys issued to THIS person on this organization, never the whole
 * roster. Read-only: issuing and revoking stay on the API Keys page, which
 * already carries the scopes and confirmations that go with them.
 */

import { apiKeyClient } from "@langwatch/api-key-client";
import { Link } from "@langwatch/browser-host/link";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingsSection, SettingsSectionRow } from "@langwatch/design-system/settings-section";
import { toEpochMs } from "@langwatch/time";
import { KeySquare } from "lucide-react";
import { useEffect } from "react";

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

  const keys = apiKeyClient.apiKey.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );

  useEffect(() => {
    if (keys.isError) {
      host.failed({ error: keys.error, fallbackTitle: "Couldn't read your API keys" });
    }
  }, [keys.isError, keys.error, host]);

  if (!organizationId) return null;

  const mine = (keys.data ?? []).filter((key) => key.userId === userId && key.revokedAt === null);

  return (
    <SettingsSection
      icon={<KeySquare size={18} />}
      title="Your API keys"
      hint="The keys issued to you, and when each was last used."
      actions={
        <Button asChild size="xs" variant="outline" data-testid="api-keys-manage">
          <Link unstyled href="/settings/api-keys">
            Manage API keys
          </Link>
        </Button>
      }
      data-testid="personal-api-keys-summary"
    >
      {mine.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No key has been issued to you yet.
        </Text>
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {mine.map((key) => (
            <SettingsSectionRow key={key.id} data-testid="personal-api-key-row">
              <VStack align="start" gap={0} flex={1} minWidth={0}>
                <HStack gap={2} flexWrap="wrap">
                  <Text fontSize="sm" fontWeight={500} truncate>
                    {key.name}
                  </Text>
                  <Badge variant="surface" size="sm" colorPalette="gray">
                    {permissionLabel(key.permissionMode)}
                  </Badge>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  Last used {formatRelativeTime(key.lastUsedAt ? toEpochMs(key.lastUsedAt) : null)}
                </Text>
              </VStack>
            </SettingsSectionRow>
          ))}
        </VStack>
      )}
    </SettingsSection>
  );
}
