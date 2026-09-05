import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { KeySquare } from "lucide-react";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import RouterLink from "~/utils/compat/next-link";
import { IdentityChip } from "../access/IdentityRow";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import {
  SettingsSection,
  SettingsSectionRow,
} from "../settings/SettingsSection";
import { formatRelativeTime } from "./relativeTime";

/**
 * The API keys that belong to THIS person, and nobody else's.
 *
 * An organization administrator's key listing answers with the whole
 * organization's keys, which is the right answer on the page that governs
 * them and the wrong one here: this section is about the reader's own
 * credentials, so it keeps only the rows they own. An administrator reading
 * their own profile sees their own keys, not their colleagues'.
 *
 * READ-ONLY, like the sign-in methods above it. Issuing and revoking a key
 * lives on the API Keys page, which already holds the scopes, the permission
 * modes and the confirmations that go with them; a second place to mint one
 * would be a second place for that ceremony to drift.
 *
 * A key is shown by the prefix of its lookup id, which is what the listing
 * already returns — the secret itself was shown once at issue and is not ours
 * to show again.
 *
 * Spec: specs/settings/profile.feature
 */
export function PersonalApiKeysSummary({
  organizationId,
}: {
  /** The keys are organization-scoped; null before one resolves. */
  organizationId: string | null;
}) {
  const session = useSession();
  const userId = session.data?.user.id ?? null;

  const keys = api.apiKey.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId },
  );

  if (!organizationId) return null;

  const mine = (keys.data ?? []).filter(
    (key) => key.userId === userId && key.revokedAt === null,
  );

  return (
    <SettingsSection
      icon={<KeySquare size={18} />}
      title="Your API keys"
      description="The keys issued to you, and when each was last used."
      action={
        // The same button the sign-in methods above it carry. Two summary
        // bands on one page whose only control is "go to the page that
        // changes this" have to offer it as the same object, or the page
        // reads as two conventions arguing.
        <Button
          asChild
          size="xs"
          variant="outline"
          data-testid="api-keys-manage"
        >
          <RouterLink href="/settings/api-keys">Manage API keys</RouterLink>
        </Button>
      }
      testId="personal-api-keys-settings-section"
    >
      {keys.isError ? (
        <SectionErrorNotice
          error={keys.error}
          fallbackTitle="Couldn't read your API keys"
        />
      ) : keys.isPending ? (
        <SettingsRowsSkeleton rows={2} />
      ) : mine.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No key has been issued to you yet.
        </Text>
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {mine.map((key) => (
            <SettingsSectionRow key={key.id} testId="personal-api-key-row">
              <VStack align="start" gap={0} flex={1} minWidth={0}>
                <HStack gap={2} flexWrap="wrap">
                  <Text fontSize="sm" fontWeight={500} truncate>
                    {key.name}
                  </Text>
                  <IdentityChip label={permissionLabel(key.permissionMode)} />
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  {key.lookupIdPrefix}…{" · "}
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {" · "}
                  Last used{" "}
                  {formatRelativeTime(
                    key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : null,
                  )}
                </Text>
              </VStack>
            </SettingsSectionRow>
          ))}
        </VStack>
      )}
    </SettingsSection>
  );
}

/** The permission mode, in the words the API Keys page uses. */
function permissionLabel(mode: string): string {
  if (mode === "readonly") return "Read only";
  if (mode === "restricted") return "Restricted";
  return "Full access";
}
