import { Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { providerDisplayName } from "@ee/sso/logic/providerDisplayName";
import type { SelfServeMigrationView } from "@ee/sso/sso-self-serve.types";
import type {
  SsoConnectionLifecycleState,
  SsoMigrationPhase,
} from "@langwatch/identity";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { SettingList, SettingRow } from "~/components/settings/kit/SettingRow";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { Tooltip } from "~/components/ui/tooltip";
import { api } from "~/utils/api";
import { LoadFailure, reportRefusal } from "./refusals";

/**
 * THE WORDS ON THIS PANEL ARE THE CUSTOMER'S, NOT THE LEDGER'S.
 *
 * What an organization is doing here is replacing the sign-in it has with one
 * it owns. The code underneath calls that a migration, and the aggregate's
 * phases are named for the routing state they hold; neither is a thing an
 * administrator has ever heard of, so neither word reaches the screen. The
 * identifiers stay exactly as they are — renaming them would change nothing a
 * customer reads and everything a reviewer has to re-learn.
 */

/** Which names this panel has to hand, once, so every line spells them the
 *  same way. */
interface UpdateNames {
  /** The provider signing people in before the update started. */
  previous: string;
  /** What the organization registered to replace it. */
  replacement: string;
}

/**
 * Where the update stands, in one line the administrator can act on.
 *
 * Every phase says WHO IS SIGNING IN RIGHT NOW first, because that is the only
 * fact on this screen that can wake somebody at night.
 */
const PHASE_STATUS: Record<SsoMigrationPhase, (names: UpdateNames) => string> =
  {
    SETUP: ({ previous }) =>
      `Everyone still signs in through ${previous}. Set the new connection up and test it, and nothing changes for your members until you switch over.`,
    GRACE_LEGACY: ({ previous }) =>
      `Everyone still signs in through ${previous}. Switch sign-in over when the new connection is ready.`,
    GRACE_DIRECT: ({ previous, replacement }) =>
      `Everyone signs in through ${replacement}. You can switch back to ${previous} until you start finishing the update.`,
    FINALIZING: ({ previous }) =>
      `Finishing the update. Access through ${previous} is being taken away.`,
    FINALIZED: ({ previous, replacement }) =>
      `Everyone signs in through ${replacement}. ${previous} no longer signs anybody in.`,
  };

/** The same five phases as a chip, for the cards that only have room for a
 *  word. Exported because the Authentication overview wears the same one —
 *  two screens saying different words about one state is how a reader ends up
 *  believing they are two states. */
export function singleSignOnUpdateChipFor(phase: SsoMigrationPhase): {
  label: string;
  tone: "neutral" | "good" | "warning" | "bad";
  title: string;
} {
  const chip = PHASE_CHIP[phase];
  return { ...chip, title: chip.title };
}

const PHASE_CHIP: Record<
  SsoMigrationPhase,
  { label: string; tone: "neutral" | "good" | "warning" | "bad"; title: string }
> = {
  SETUP: {
    label: "Setting up",
    tone: "warning",
    title:
      "Your new connection is registered. Everyone still signs in the way they did before.",
  },
  GRACE_LEGACY: {
    label: "Testing",
    tone: "warning",
    title:
      "Your new connection is ready to test. Everyone still signs in the way they did before.",
  },
  GRACE_DIRECT: {
    label: "Switched over",
    tone: "good",
    title:
      "Everyone signs in through your new connection. You can still switch back.",
  },
  FINALIZING: {
    label: "Finishing",
    tone: "warning",
    title: "Access through your previous provider is being taken away.",
  },
  FINALIZED: {
    label: "Complete",
    tone: "good",
    title: "Your new connection is the only way your people sign in.",
  },
};

/**
 * What each outstanding check means to the person who has to clear it, and
 * what the same check reads as when it is simply one of the conditions.
 *
 * Keyed by the blocker's own stable code rather than rendered from the
 * server's sentence, for the reason the error registry exists: the code is the
 * contract and the prose is copy. `message` is still the fallback, so a check
 * added on the server says something true here before anybody writes its
 * words.
 */
const UPDATE_CHECKS: Record<
  string,
  {
    act: (names: UpdateNames & { unlinked: number }) => string;
    condition: string;
  }
> = {
  "direct-route-not-selected": {
    act: () => "Switch sign-in over to your new connection.",
    condition: "Your people sign in through the new connection.",
  },
  "replacement-not-tested": {
    act: () => "Sign in through the new connection once, and make it work.",
    condition: "A sign-in through the new connection has worked.",
  },
  "recovery-path-missing": {
    act: () =>
      "Give at least one person a way in that does not use your identity provider, and give it to somebody who has set a password. Once the update finishes your previous provider will not be there to sign them in, and a password can only be set while somebody is still signed in.",
    condition:
      "Somebody can still sign in without your identity provider, with a password set.",
  },
  "members-not-linked": {
    act: ({ unlinked }) =>
      `${unlinked} ${unlinked === 1 ? "member has" : "members have"} not signed in through the new connection yet.`,
    condition: "Every member has signed in through the new connection.",
  },
  "legacy-activity-not-quiet": {
    act: ({ previous }) =>
      `Wait for seven days with nobody signing in through ${previous}.`,
    condition:
      "Nobody has signed in through the previous provider for seven days.",
  },
  "scim-needs-repointing": {
    act: () => "Point your directory sync at the new connection.",
    condition: "Your directory sync points at the new connection.",
  },
  "shared-legacy-identifiers": {
    act: ({ previous }) =>
      `An account that signs in through ${previous} is shared with another organization. Contact support to sort it out.`,
    condition: "No account is shared with another organization.",
  },
  "replacement-not-active": {
    act: () => "Turn the new connection on.",
    condition: "The new connection is on.",
  },
  "domain-ownership-proof-missing": {
    act: () =>
      "Prove your domain again. The new connection no longer holds a current proof of it.",
    condition: "The new connection holds a current proof of your domain.",
  },
  "legacy-provider-ambiguous": {
    act: () =>
      "An account is also covered by another organization's provider. Contact support to sort it out.",
    condition: "No account is covered by another organization's provider.",
  },
  "legacy-account-association-ambiguous": {
    act: () =>
      "An account cannot be matched to a connection. Contact support to sort it out.",
    condition: "Every account can be matched to a connection.",
  },
  "members-not-verified-on-replacement": {
    act: () =>
      "Every current member needs a verified sign-in on the new connection before access through the previous provider is taken away.",
    condition:
      "Every current member has a verified sign-in on the new connection.",
  },
};

/** Every condition that has to be true before the update can be finished, in
 *  one list, for the help beside the button. Derived from the same record the
 *  outstanding checks are written from, so the two cannot drift. */
export const UPDATE_FINISH_CONDITIONS: readonly string[] = Object.values(
  UPDATE_CHECKS,
).map((check) => check.condition);

/** Every check this screen has words for, so a test can hold it against the
 *  checks the service can actually report. A check with no copy here still
 *  renders — the server's own sentence is the fallback — but it renders in the
 *  ledger's vocabulary rather than the customer's, which is what the pin is
 *  there to catch. */
export const UPDATE_CHECK_CODES: readonly string[] = Object.keys(UPDATE_CHECKS);

/** One outstanding check, in words the administrator can act on. */
function checkCopyFor({
  blocker,
  names,
  unlinked,
}: {
  blocker: SelfServeMigrationView["blockers"][number];
  names: UpdateNames;
  unlinked: number;
}): string {
  const check = UPDATE_CHECKS[blocker.code];
  return check ? check.act({ ...names, unlinked }) : blocker.message;
}

/** What the organization's directory sync still needs, said rather than
 *  spelled out of an internal status word. */
const DIRECTORY_STATUS: Record<
  SelfServeMigrationView["scim"]["status"],
  string
> = {
  "not-applicable": "Not in use",
  "needs-repointing": "Point it at the new connection",
  ready: "Ready",
};

/** Inherited trust and newly published proof carry different provenance. */
function inheritedDomainLine(entry: {
  domain: string;
  method: string;
}): string {
  let proof = "your existing setup";
  if (entry.method === "operator-attested") {
    proof = "operator attestation";
  } else if (entry.method === "dns-txt" || entry.method === "https-file") {
    proof = "published domain proof";
  } else if (entry.method === "license-token") {
    proof = "installation licence";
  }

  return `${entry.domain} (${proof})`;
}

export function MigrationProgress({
  organizationId,
  canManage,
  migration,
  connectionState,
}: {
  organizationId: string;
  canManage: boolean;
  migration: SelfServeMigrationView;
  connectionState: SsoConnectionLifecycleState;
}) {
  const name = providerDisplayName(migration.legacy.providerId);
  // The stored identifier is never rendered; the replacement is a connection
  // the administrator just registered, so "your new connection" is what they
  // called it a moment ago when we cannot spell the vendor.
  const replacementName =
    providerDisplayName(migration.replacement.providerId) ??
    "your new connection";
  const names: UpdateNames = {
    previous: name ?? "your previous provider",
    replacement: replacementName,
  };
  const unlinked = Math.max(
    migration.members.activeCount - migration.members.linkedCount,
    0,
  );
  return (
    <SettingsCard
      title={name ? `Replacing ${name}` : "Replacing your current sign-in"}
      badge={<UpdatePhaseChip phase={migration.phase} />}
    >
      {/* WHERE IT STANDS, BEFORE ANY OF THE DETAIL. An administrator opening
          this card is asking one question — who is signing in right now — and
          the rows below only make sense once it is answered. */}
      <Text fontSize="sm" data-testid="sso-update-status">
        {PHASE_STATUS[migration.phase](names)}
      </Text>
      <SettingList>
        <SettingRow label="Signing people in">
          <Text fontSize="sm">
            {/* This row reports who is serving sign-in RIGHT NOW, so on the
                previous provider's route the unnamed fallback is the present
                tense. */}
            {migration.selectedRoute === "legacy"
              ? (name ?? "Your existing provider")
              : (providerDisplayName(migration.replacement.providerId) ??
                "Your new connection")}
          </Text>
        </SettingRow>
        <SettingRow label="Members moved across">
          <Text fontSize="sm">
            {migration.members.linkedCount} of {migration.members.activeCount}
          </Text>
        </SettingRow>
        <SettingRow label="Directory sync">
          <Text fontSize="sm">{DIRECTORY_STATUS[migration.scim.status]}</Text>
        </SettingRow>
      </SettingList>
      {migration.inheritedDomains.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {migration.inheritedDomains.map(inheritedDomainLine).join(", ")}
        </Text>
      )}
      <MigrationStragglers
        key={`${organizationId}:${migration.replacement.connectionId}`}
        organizationId={organizationId}
        connectionId={migration.replacement.connectionId}
        initialMembers={migration.members}
        previous={names.previous}
      />
      {/* The heading and its help stay once every check passes: that is the
          moment an administrator re-reads the conditions before finishing. */}
      {migration.phase !== "FINALIZED" && (
        <VStack align="stretch" gap={1}>
          <HStack gap={1}>
            <Text fontSize="xs" fontWeight="semibold">
              Before you can finish
            </Text>
            <FinishConditionsHelp />
          </HStack>
          {migration.blockers.length === 0 ? (
            <Text fontSize="xs" color="fg.muted">
              Every check has passed.
            </Text>
          ) : (
            migration.blockers.map((blocker) => (
              <Text key={blocker.code} fontSize="xs" color="fg.muted">
                {checkCopyFor({ blocker, names, unlinked })}
              </Text>
            ))
          )}
        </VStack>
      )}
      {canManage && migration.phase !== "FINALIZED" && (
        <MigrationActions
          organizationId={organizationId}
          migration={migration}
          connectionState={connectionState}
          previous={names.previous}
        />
      )}
    </SettingsCard>
  );
}

/** Where the update stands, as one word. */
function UpdatePhaseChip({ phase }: { phase: SsoMigrationPhase }) {
  const chip = singleSignOnUpdateChipFor(phase);
  return (
    <IdentityChip
      label={chip.label}
      tone={chip.tone}
      title={chip.title}
      data-testid="sso-update-chip"
    />
  );
}

/**
 * Every condition, on the help beside the heading.
 *
 * The lines above say what is OUTSTANDING, which is the short list somebody
 * acts on; "which checks are there at all" is the question they ask once, and
 * copywriting.md puts that answer on a help icon rather than in the middle of
 * the work.
 */
function FinishConditionsHelp() {
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={0.5}>
          {UPDATE_FINISH_CONDITIONS.map((condition) => (
            <Text key={condition} fontSize="xs">
              {condition}
            </Text>
          ))}
        </VStack>
      }
    >
      {/* A button, not a span, so the keyboard can reach the tooltip. */}
      <IconButton
        size="2xs"
        variant="plain"
        color="fg.subtle"
        minWidth="auto"
        height="auto"
        cursor="help"
        aria-label="Everything that has to be true before you can finish"
        data-testid="sso-update-conditions-help"
      >
        <HelpCircle size={12} />
      </IconButton>
    </Tooltip>
  );
}

function MigrationActions({
  organizationId,
  migration,
  connectionState,
  previous,
}: {
  organizationId: string;
  migration: SelfServeMigrationView;
  connectionState: SsoConnectionLifecycleState;
  previous: string;
}) {
  const route = api.ssoSetup.selectMigrationRoute.useMutation();
  const finalize = api.ssoSetup.finalizeLegacyMigration.useMutation();
  const utils = api.useUtils();
  const settle = {
    onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
    onError: reportRefusal,
  };
  const routeLocked =
    migration.phase === "FINALIZING" || migration.phase === "FINALIZED";
  const active = connectionState === "ACTIVE";
  const pending = route.isPending || finalize.isPending;

  return (
    <HStack gap={2} flexWrap="wrap">
      {!routeLocked &&
        (migration.selectedRoute === "legacy" ? (
          <Button
            size="sm"
            loading={route.isPending}
            disabled={!active || !migration.testSignIn.done || pending}
            onClick={() =>
              route.mutate(
                {
                  organizationId,
                  connectionId: migration.replacement.connectionId,
                  route: "direct",
                },
                settle,
              )
            }
          >
            Switch sign-in over
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            loading={route.isPending}
            disabled={!active || pending}
            onClick={() =>
              route.mutate(
                {
                  organizationId,
                  connectionId: migration.replacement.connectionId,
                  route: "legacy",
                },
                settle,
              )
            }
          >
            Switch back to {previous}
          </Button>
        ))}
      <Button
        size="sm"
        variant="outline"
        loading={finalize.isPending}
        disabled={!active || !migration.canFinalize || pending}
        onClick={() =>
          finalize.mutate(
            {
              organizationId,
              connectionId: migration.replacement.connectionId,
            },
            settle,
          )
        }
      >
        {migration.phase === "FINALIZING"
          ? "Try finishing again"
          : "Finish the update"}
      </Button>
    </HStack>
  );
}

function MigrationStragglers({
  organizationId,
  connectionId,
  initialMembers,
  previous,
}: {
  organizationId: string;
  connectionId: string;
  initialMembers: SelfServeMigrationView["members"];
  previous: string;
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1) ?? null;
  const page = api.ssoSetup.getMigrationProgress.useQuery(
    { organizationId, connectionId, cursor, limit: 25 },
    { enabled: cursor !== null },
  );
  const members = cursor === null ? initialMembers : page.data?.members;
  const error = cursor === null ? null : page.error;
  const loading = cursor !== null && page.isFetching;
  const nextCursor = members?.nextCursor;

  if (cursor === null && initialMembers.stragglers.length === 0) return null;

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="sm" fontWeight="semibold">
        Still using {previous}
      </Text>
      <MigrationMemberRows error={error} loading={loading} members={members} />
      <HStack gap={2}>
        {cursor !== null && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCursors((history) => history.slice(0, -1))}
          >
            Previous members
          </Button>
        )}
        {error && (
          <Button
            size="sm"
            variant="outline"
            loading={loading}
            onClick={() => void page.refetch()}
          >
            Retry members
          </Button>
        )}
        {!error && nextCursor && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => setCursors((history) => [...history, nextCursor])}
          >
            Next members
          </Button>
        )}
      </HStack>
    </VStack>
  );
}

function MigrationMemberRows({
  error,
  loading,
  members,
}: {
  error: unknown;
  loading: boolean;
  members: SelfServeMigrationView["members"] | undefined;
}) {
  if (error) {
    return (
      <LoadFailure
        error={error}
        what="the members still using the previous provider"
      />
    );
  }
  if (loading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading members…
      </Text>
    );
  }
  if (!members) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This list is no longer available.
      </Text>
    );
  }
  if (members.stragglers.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No remaining members on this page.
      </Text>
    );
  }

  return (
    <>
      {members.stragglers.map((person) => (
        <Text key={person.userId} fontSize="xs" color="fg.muted">
          {person.name ?? person.email ?? person.userId}
        </Text>
      ))}
    </>
  );
}
