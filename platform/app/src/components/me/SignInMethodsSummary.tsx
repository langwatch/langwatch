import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { signInMethodLabel } from "~/features/auth/logic/methodLabels";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";
import { IdentityChip } from "../access/IdentityRow";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import {
  SettingsSection,
  SettingsSectionRow,
} from "../settings/SettingsSection";
import { Link } from "../ui/link";

/**
 * How this account signs in, said in one line per method.
 *
 * A SUMMARY AND NOT A SECOND CONTROL PANEL. Everything here is managed on
 * Security, and this section does nothing but read: two pages that both add
 * an address, both remove a passkey and both change a password would be two
 * places for the same refusal to be worded differently, and the detach guards
 * would be read out loud twice. So there is exactly one control on it, and it
 * is a link to the page that holds the real ones.
 *
 * It earns its place on Profile because "how do people get into this account"
 * is part of what the account IS, and a reader who has just set their name and
 * photo is the reader most likely to want to check it.
 *
 * WHAT AN ORGANIZATION REQUIRES IS NOT HERE. A second-factor requirement
 * belongs to an organization and lives on its Access page; what this says is
 * only what this person actually holds.
 *
 * Spec: specs/settings/profile.feature
 */
export function SignInMethodsSummary() {
  const publicEnv = usePublicEnv();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const password = api.user.hasPassword.useQuery({});
  const twoStep = api.twoStepVerification.account.useQuery({});
  const passkeys = authClient.useListPasskeys();

  const offersPasskeys = publicEnv.data?.PASSKEYS_ENABLED === true;

  return (
    <SettingsSection
      icon={<KeyRound size={18} />}
      title="Sign-in methods"
      description="What this account can prove it is with."
      action={
        <Link
          href="/settings/security"
          fontSize="sm"
          data-testid="sign-in-methods-manage"
        >
          Manage
        </Link>
      }
      testId="sign-in-methods-settings-section"
    >
      {identifiers.isError ? (
        <SectionErrorNotice
          error={identifiers.error}
          fallbackTitle="Couldn't read your sign-in methods"
        />
      ) : identifiers.isPending ? (
        <Spinner size="sm" />
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {methodRows({
            identifiers: identifiers.data ?? [],
            offersPasskeys,
            passkeyCount: passkeys.data?.length ?? 0,
            hasPassword: password.data?.hasPassword === true,
            twoStep: twoStep.data ?? null,
          }).map((row) => (
            <MethodRow key={row.key} {...row} />
          ))}
        </VStack>
      )}

      {/* A read that failed takes its own row's word away, never the section:
          the methods above it are still on screen and still true. */}
      {password.isError && (
        <SectionErrorNotice
          error={password.error}
          fallbackTitle="Couldn't tell whether you have a password"
        />
      )}
      {twoStep.isError && (
        <SectionErrorNotice
          error={twoStep.error}
          fallbackTitle="Couldn't read your two-step verification"
        />
      )}
    </SettingsSection>
  );
}

/** One line of the summary, before anything draws it. */
interface MethodRowProps {
  key: string;
  label: string;
  detail: string;
  chip: string | null;
  testId: string;
}

/**
 * The lines this account earns, in the order they are read.
 *
 * The addresses lead because they are what the account IS; the ways of
 * proving it follow. A thing the deployment does not offer contributes no
 * line at all rather than a line saying the reader does not have it — a
 * passkey row on a deployment with passkeys switched off would read as an
 * account failing to hold something it was never offered.
 */
function methodRows({
  identifiers,
  offersPasskeys,
  passkeyCount,
  hasPassword,
  twoStep,
}: {
  identifiers: ReadonlyArray<{
    identifierId: string;
    provider: string;
    value: string;
    isPrimary: boolean;
    confirmed: boolean;
  }>;
  offersPasskeys: boolean;
  passkeyCount: number;
  hasPassword: boolean;
  twoStep: { offered: boolean; enabled: boolean } | null;
}): MethodRowProps[] {
  const addresses = identifiers.filter((row) => row.provider === "email");
  const federated = identifiers.filter(
    (row) =>
      row.provider !== "email" &&
      row.provider !== "credential" &&
      row.provider !== "passkey",
  );
  const primary = addresses.find((row) => row.isPrimary) ?? addresses[0];

  return [
    {
      key: "email",
      label: "Email address",
      detail: primary?.value ?? "None yet",
      chip: addressChip({ count: addresses.length, primary }),
      testId: "method-row-email",
    },
    ...federated.map((row) => ({
      key: row.identifierId,
      label: labelFor(row.provider),
      detail: row.value,
      chip: null,
      testId: "method-row-federated",
    })),
    ...(offersPasskeys
      ? [
          {
            key: "passkeys",
            label: "Passkeys",
            detail: passkeyDetail(passkeyCount),
            chip: null,
            testId: "method-row-passkeys",
          },
        ]
      : []),
    {
      key: "password",
      label: "Password",
      detail: hasPassword ? "Set" : "Not set",
      chip: null,
      testId: "method-row-password",
    },
    ...(twoStep?.offered
      ? [
          {
            key: "two-step",
            label: "Two-step verification",
            detail: twoStep.enabled ? "On" : "Off",
            chip: null,
            testId: "method-row-two-step",
          },
        ]
      : []),
  ];
}

/**
 * What the address line has to add: how many there are when there is more
 * than one, or that the only one is still unconfirmed — which is the state
 * that will lock somebody out and the one worth marking.
 */
function addressChip({
  count,
  primary,
}: {
  count: number;
  primary: { confirmed: boolean } | undefined;
}): string | null {
  if (count > 1) return `${count} addresses`;
  if (count === 1 && primary?.confirmed === false) return "Unconfirmed";
  return null;
}

function labelFor(provider: string): string {
  const label = signInMethodLabel({
    kind: "federated",
    id: provider,
    connectionId: null,
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function passkeyDetail(count: number): string {
  if (count === 0) return "None yet";
  return count === 1 ? "1 passkey" : `${count} passkeys`;
}

function MethodRow({
  label,
  detail,
  chip,
  testId,
}: {
  label: string;
  detail: string;
  chip: string | null;
  testId: string;
}) {
  return (
    <SettingsSectionRow testId={testId}>
      <Text fontSize="sm" fontWeight={500} minWidth="160px">
        {label}
      </Text>
      <HStack gap={2} flex={1} minWidth={0}>
        <Text fontSize="sm" color="fg.muted" truncate>
          {detail}
        </Text>
        {chip && <IdentityChip label={chip} />}
      </HStack>
    </SettingsSectionRow>
  );
}
