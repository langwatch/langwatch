/**
 * How this account signs in, one line each: read-only, because everything
 * here is changed on Security. Two pages that both add an address would be
 * two places for the same refusal to be worded differently.
 */

import { Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost, type HeldPasskey } from "../../model/personal-workspace-host.ts";
import { providerDisplayName } from "../../model/sign-in-methods.ts";

/** One line: what a way in is called, and what it says about it. */
function MethodLine({ testId, label, detail }: { testId: string; label: string; detail: string }) {
  return (
    <HStack width="full" gap={2} data-testid={testId}>
      <Text fontSize="sm">{label}</Text>
      <Spacer />
      <Text fontSize="sm" color="fg.muted">
        {detail}
      </Text>
    </HStack>
  );
}

export function SignInMethodsSummary() {
  const host = usePersonalWorkspaceHost();
  const address = host.currentUser()?.email ?? null;
  const passkeysEnabled = host.deployment().passkeysEnabled;

  const [passkeys, setPasskeys] = useState<readonly HeldPasskey[] | null>(null);
  useEffect(() => {
    if (!passkeysEnabled) return;
    void host.listPasskeys().then(setPasskeys);
  }, [passkeysEnabled, host]);

  const accounts = api.user.getLinkedAccounts.useQuery({});
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const password = api.user.hasPassword.useQuery({});

  useEffect(() => {
    if (password.isError) {
      host.failed({
        error: password.error,
        fallbackTitle: "Couldn't tell whether you have a password",
      });
    }
  }, [password.isError, password.error, host]);

  const linked = accounts.data ?? [];
  const addresses = (identifiers.data ?? []).filter(
    (identifier) => identifier.provider === "email" && identifier.value,
  );

  return (
    <VStack align="stretch" gap={3} width="full" data-testid="sign-in-methods-summary">
      <HStack justify="space-between" width="full">
        <HStack gap={2}>
          <KeyRound size={18} />
          <Text fontWeight={600}>Sign-in methods</Text>
        </HStack>
        <Button asChild size="xs" variant="outline" data-testid="sign-in-methods-manage">
          <a href="/settings/authentication">Manage on Security</a>
        </Button>
      </HStack>

      <VStack align="stretch" gap={2} width="full">
        {addresses.length > 0 ? (
          addresses.map((identifier) => (
            <MethodLine
              key={identifier.identifierId}
              testId="method-line-address"
              label={identifier.value ?? ""}
              detail={identifier.confirmed ? "Confirmed" : "Not confirmed yet"}
            />
          ))
        ) : (
          <MethodLine testId="method-line-address" label="Address" detail={address ?? "None yet"} />
        )}

        {linked.map((account) => (
          <MethodLine
            key={account.id}
            testId="method-line-linked-account"
            label={providerDisplayName(account.provider, account.providerAccountId)}
            detail="Linked"
          />
        ))}

        {passkeysEnabled && (
          <MethodLine
            testId="method-line-passkeys"
            label="Passkeys"
            detail={passkeyDetail(passkeys)}
          />
        )}

        <MethodLine
          testId="method-line-password"
          label="Password"
          detail={password.data?.hasPassword ? "Set" : "Not set"}
        />
      </VStack>
    </VStack>
  );
}

/** What the passkey line says while the read is still in flight. */
function passkeyDetail(passkeys: readonly HeldPasskey[] | null): string {
  if (passkeys === null) return "…";
  if (passkeys.length === 0) return "None yet";
  return `${passkeys.length} passkey${passkeys.length === 1 ? "" : "s"}`;
}
