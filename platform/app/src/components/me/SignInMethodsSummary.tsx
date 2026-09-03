import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { signInMethodLabel } from "~/features/auth/logic/methodLabels";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";
import RouterLink from "~/utils/compat/next-link";
import { IdentityChip } from "../access/IdentityRow";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import {
  SettingsSection,
  SettingsSectionRow,
} from "../settings/SettingsSection";

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
 * THE ADDRESS COMES FROM TWO READS, AND IT HAS TO. The identifier projection
 * is the richer answer — several addresses, which one is primary, which are
 * confirmed — but it is only populated for accounts that have attached an
 * identifier since the projection shipped. An account that predates it, or one
 * created by a passkey and never asked for a second address, has an address on
 * its user record and NOTHING in the projection, and this section read the
 * projection alone: it said "None yet" directly under the identity card
 * showing that person's own address. So the account's own address stands in
 * where the projection has nothing, from `auth.myAddressConfirmation` — the
 * same read the Security page and the shell's nudge already make, so the three
 * can never disagree about the address or about whether it is confirmed.
 *
 * "None yet" now means what it says: no address in the projection AND none on
 * the account.
 *
 * Spec: specs/settings/profile.feature
 */
export function SignInMethodsSummary() {
  const publicEnv = usePublicEnv();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const confirmation = api.auth.myAddressConfirmation.useQuery();
  const password = api.user.hasPassword.useQuery({});
  const twoStep = api.twoStepVerification.account.useQuery({});
  const passkeys = authClient.useListPasskeys();

  return (
    <SettingsSection
      icon={<KeyRound size={18} />}
      title="Sign-in methods"
      description="What this account can prove it is with."
      action={
        // A BUTTON, not a sentence. This is the one control on the section and
        // it was set as bare link text beside a bold title, where it read as a
        // stray word rather than as the thing to press. Outline and xs: it has
        // a real edge so it is obviously pressable, and it stays quieter than
        // anything inside the band — a section header is a label, not a call
        // to action.
        <Button
          asChild
          size="xs"
          variant="outline"
          data-testid="sign-in-methods-manage"
        >
          {/* The router's own link, not the themed `Link`: that one is a
              Chakra link recipe and nesting it inside a button recipe puts two
              sets of colour and underline rules on one element. */}
          <RouterLink href="/settings/security">Manage</RouterLink>
        </Button>
      }
      testId="sign-in-methods-settings-section"
    >
      {identifiers.isError ? (
        <SectionErrorNotice
          error={identifiers.error}
          fallbackTitle="Couldn't read your sign-in methods"
        />
      ) : identifiers.isPending || confirmation.isPending ? (
        // Both reads gate the first row: drawing "None yet" for the half a
        // second before the account's own address lands is the bug this
        // section just had, with a shorter run time.
        //
        // Four rows, because that is what this section almost always holds —
        // an address, a password, a passkey and a second step.
        <SettingsRowsSkeleton rows={4} />
      ) : (
        <VStack align="stretch" gap={2} width="full">
          {methodRows({
            identifiers: identifiers.data ?? [],
            accountAddress: confirmation.data ?? null,
            passkeyCount: passkeys.data?.length ?? 0,
            hasPassword: password.data?.hasPassword === true,
            twoStep: twoStep.data ?? null,
          }).map(({ key, ...row }) => (
            // `key` is React's, not a prop: spreading the whole row after it
            // set it twice, and the spread won.
            <MethodRow key={key} {...row} />
          ))}
        </VStack>
      )}

      <PartialReadNotices
        confirmation={confirmation.error}
        password={password.error}
        twoStep={twoStep.error}
      />
    </SettingsSection>
  );
}

/**
 * The reads that failed while the rest of the section carried on.
 *
 * A read that failed takes its own row's word away, never the section: the
 * methods still on screen are still true, and the reader is told which
 * question could not be answered rather than being left to notice a gap.
 * `SectionErrorNotice` says nothing when handed nothing, so each of these is a
 * statement rather than a branch.
 */
function PartialReadNotices({
  confirmation,
  password,
  twoStep,
}: {
  confirmation: unknown;
  password: unknown;
  twoStep: unknown;
}) {
  return (
    <>
      <SectionErrorNotice
        error={confirmation}
        fallbackTitle="Couldn't read the address on your account"
      />
      <SectionErrorNotice
        error={password}
        fallbackTitle="Couldn't tell whether you have a password"
      />
      <SectionErrorNotice
        error={twoStep}
        fallbackTitle="Couldn't read your two-step verification"
      />
    </>
  );
}

/** One line of the summary, before anything draws it. */
interface MethodRowProps {
  key: string;
  label: string;
  detail: string;
  /** A state worth marking beside the value. Neutral unless the state is one
   *  somebody has to act on — a tone on every chip is a tone on none. */
  chip: { label: string; tone: "neutral" | "warning" } | null;
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
  accountAddress,
  passkeyCount,
  hasPassword,
  twoStep,
}: {
  identifiers: ReadonlyArray<{
    identifierId: string;
    provider: string;
    /** Null when we hold no display value for it — the read's own type
     *  permits it, and a row that assumed a string rendered `undefined`. */
    value: string | null;
    isPrimary: boolean;
    confirmed: boolean;
  }>;
  /** The address on the account itself, for the accounts whose identifier
   *  projection holds nothing — see the section's docblock. */
  accountAddress: { email: string | null; confirmed: boolean } | null;
  passkeyCount: number;
  hasPassword: boolean;
  twoStep: { offered: boolean; enabled: boolean } | null;
}): MethodRowProps[] {
  // Narrowed at the filter rather than asserted downstream: an email
  // identifier we hold no address for is not an address anybody can be shown.
  const addresses = identifiers.filter(
    (row): row is (typeof identifiers)[number] & { value: string } =>
      row.provider === "email" && row.value !== null,
  );
  const federated = identifiers.filter(
    (row) =>
      row.provider !== "email" &&
      row.provider !== "credential" &&
      row.provider !== "passkey",
  );
  const shown = shownAddress({ addresses, accountAddress });

  return [
    {
      key: "email",
      label: "Email address",
      detail: shown?.value ?? "None yet",
      chip: addressChip({ count: addresses.length, shown }),
      testId: "method-row-email",
    },
    ...federated.map((row) => ({
      key: row.identifierId,
      label: labelFor(row.provider),
      detail: row.value ?? "Not recorded",
      chip: null,
      testId: "method-row-federated",
    })),
    {
      key: "passkeys",
      label: "Passkeys",
      detail: passkeyDetail(passkeyCount),
      chip: null,
      testId: "method-row-passkeys",
    },
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
 * The address this line states, from whichever read can state one.
 *
 * The projection first, because it is the richer answer and the only one that
 * knows about a second address. The account's own address second, because an
 * account whose projection is empty still HAS an address — and saying "None
 * yet" about it, on a page whose identity card is showing that very address,
 * is the screen calling itself a liar.
 *
 * Nothing at all is the third answer, and it is a real one: an account with no
 * address anywhere gets "None yet", which now means it.
 */
function shownAddress({
  addresses,
  accountAddress,
}: {
  addresses: ReadonlyArray<{
    value: string;
    isPrimary: boolean;
    confirmed: boolean;
  }>;
  accountAddress: { email: string | null; confirmed: boolean } | null;
}): { value: string; confirmed: boolean } | null {
  const primary = addresses.find((row) => row.isPrimary) ?? addresses[0];
  if (primary) {
    return { value: primary.value, confirmed: primary.confirmed };
  }
  if (accountAddress?.email) {
    return { value: accountAddress.email, confirmed: accountAddress.confirmed };
  }
  return null;
}

/**
 * What the address line has to add: how many there are when there is more
 * than one, or that the one on screen is still unconfirmed — which is the
 * state that will lock somebody out and the one worth marking.
 *
 * The words are the Security page's words. An address the reader sees marked
 * "Not confirmed yet" there must not be marked "Unconfirmed" here: one state
 * with two names reads as two states.
 */
function addressChip({
  count,
  shown,
}: {
  count: number;
  shown: { confirmed: boolean } | null;
}): MethodRowProps["chip"] {
  if (count > 1) return { label: `${count} addresses`, tone: "neutral" };
  if (shown && !shown.confirmed)
    return { label: "Not confirmed yet", tone: "warning" };
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
}: Omit<MethodRowProps, "key">) {
  return (
    <SettingsSectionRow testId={testId}>
      <Text fontSize="sm" fontWeight={500} minWidth="160px">
        {label}
      </Text>
      <HStack gap={2} flex={1} minWidth={0}>
        <Text fontSize="sm" color="fg.muted" truncate>
          {detail}
        </Text>
        {chip && <IdentityChip label={chip.label} tone={chip.tone} />}
      </HStack>
    </SettingsSectionRow>
  );
}
