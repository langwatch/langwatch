/**
 * How this account signs in, one bordered row each: read-only, because
 * everything here is changed on Security. Two pages that both add an address
 * would be two places for the same refusal to be worded differently.
 */

import { Link } from "@langwatch/browser-host/link";
import { Badge, Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingsSection, SettingsSectionRow } from "@langwatch/design-system/settings-section";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost, type HeldPasskey } from "../../model/personal-workspace-host.ts";
import { signInMethodRows, type SignInMethodRow } from "../../model/sign-in-methods.ts";

function MethodRow({ label, detail, chip, testId }: Omit<SignInMethodRow, "key">) {
  return (
    <SettingsSectionRow data-testid={testId}>
      <Text fontSize="sm" fontWeight={500} minWidth="160px">
        {label}
      </Text>
      <HStack gap={2} flex={1} minWidth={0}>
        <Text fontSize="sm" color="fg.muted" truncate>
          {detail}
        </Text>
        {chip && (
          <Badge
            size="sm"
            variant="subtle"
            colorPalette={chip.tone === "warning" ? "orange" : "gray"}
          >
            {chip.label}
          </Badge>
        )}
      </HStack>
    </SettingsSectionRow>
  );
}

/** A failed read says so in words, once, and leaves the other rows standing. */
function useReportFailure(error: unknown, fallbackTitle: string) {
  const host = usePersonalWorkspaceHost();
  useEffect(() => {
    if (error) host.failed({ error, fallbackTitle });
  }, [error, fallbackTitle, host]);
}

export function SignInMethodsSummary() {
  const host = usePersonalWorkspaceHost();
  const passkeysEnabled = host.deployment().passkeysEnabled;

  const [passkeys, setPasskeys] = useState<readonly HeldPasskey[] | null>(null);
  useEffect(() => {
    if (!passkeysEnabled) return;
    void host.listPasskeys().then(setPasskeys);
  }, [passkeysEnabled, host]);

  const identifiers = api.identity.myIdentifiers.useQuery({});
  const confirmation = api.auth.myAddressConfirmation.useQuery();
  const password = api.user.hasPassword.useQuery({});

  useReportFailure(identifiers.error, "Couldn't read your sign-in methods");
  useReportFailure(confirmation.error, "Couldn't read the address on your account");
  useReportFailure(password.error, "Couldn't tell whether you have a password");

  const rows = signInMethodRows({
    identifiers: identifiers.data ?? [],
    accountAddress: {
      email: confirmation.data?.email ?? host.currentUser()?.email ?? null,
      confirmed: confirmation.data?.confirmed ?? true,
    },
    passkeyDetail: passkeysEnabled ? passkeyDetail(passkeys) : "None yet",
    hasPassword: password.data?.hasPassword === true,
  });

  return (
    <SettingsSection
      icon={<KeyRound size={18} />}
      title="Sign-in methods"
      hint="What this account can prove it is with."
      actions={
        <Button asChild size="xs" variant="outline" data-testid="sign-in-methods-manage">
          <Link unstyled href="/settings/security">
            Manage
          </Link>
        </Button>
      }
      data-testid="sign-in-methods-summary"
    >
      {identifiers.isPending || confirmation.isPending ? (
        <Spinner size="sm" />
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {rows.map(({ key, ...row }) => (
            <MethodRow key={key} {...row} />
          ))}
        </VStack>
      )}
    </SettingsSection>
  );
}

/** What the passkey line says while the read is still in flight. */
function passkeyDetail(passkeys: readonly HeldPasskey[] | null): string {
  if (passkeys === null) return "…";
  if (passkeys.length === 0) return "None yet";
  return `${passkeys.length} passkey${passkeys.length === 1 ? "" : "s"}`;
}
