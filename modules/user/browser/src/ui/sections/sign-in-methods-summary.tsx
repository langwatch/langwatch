/**
 * How this account signs in, one bordered row each: read-only, because
 * everything here is changed on Security. Two pages that both add an address
 * would be two places for the same refusal to be worded differently.
 */

import { Badge, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost, type HeldPasskey } from "../../model/personal-workspace-host.ts";
import { signInMethodRows, type SignInMethodRow } from "../../model/sign-in-methods.ts";

function MethodRow({ label, detail, chip, testId }: Omit<SignInMethodRow, "key">) {
  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      data-testid={testId}
    >
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
    </HStack>
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
    <VStack align="stretch" gap={3} width="full" data-testid="sign-in-methods-summary">
      <HStack justify="space-between" width="full">
        <VStack align="start" gap={1}>
          <HStack gap={2}>
            <KeyRound size={18} />
            <Text fontWeight={600}>Sign-in methods</Text>
          </HStack>
          <Text color="fg.muted" fontSize="sm">
            What this account can prove it is with.
          </Text>
        </VStack>
        <Button asChild size="xs" variant="outline" data-testid="sign-in-methods-manage">
          <Link unstyled href="/settings/security">
            Manage
          </Link>
        </Button>
      </HStack>

      {identifiers.isPending || confirmation.isPending ? (
        <Spinner size="sm" />
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {rows.map(({ key, ...row }) => (
            <MethodRow key={key} {...row} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

/** What the passkey line says while the read is still in flight. */
function passkeyDetail(passkeys: readonly HeldPasskey[] | null): string {
  if (passkeys === null) return "…";
  if (passkeys.length === 0) return "None yet";
  return `${passkeys.length} passkey${passkeys.length === 1 ? "" : "s"}`;
}
