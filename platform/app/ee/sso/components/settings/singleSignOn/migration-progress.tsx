import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { providerDisplayName } from "@ee/sso/logic/providerDisplayName";
import type { SelfServeMigrationView } from "@ee/sso/sso-self-serve.types";
import type { SsoConnectionLifecycleState } from "@langwatch/identity";
import { useState } from "react";
import { SettingList, SettingRow } from "~/components/settings/kit/SettingRow";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { api } from "~/utils/api";
import { LoadFailure, reportRefusal } from "./refusals";

/** Inherited trust and newly published proof carry different provenance. */
function inheritedDomainLine(entry: {
  domain: string;
  method: string;
}): string {
  let proof = "existing legacy configuration";
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
  const previous = name ?? "the previous provider";
  return (
    <SettingsCard
      title={name ? `${name} migration` : "Single sign-on migration"}
    >
      <SettingList>
        <SettingRow label="Normal sign-in">
          <Text fontSize="sm">
            {/* This row reports who is serving sign-in RIGHT NOW, so on the
                legacy route the unnamed fallback is the present tense. */}
            {migration.selectedRoute === "legacy"
              ? (name ?? "Your existing provider")
              : migration.replacement.providerId}
          </Text>
        </SettingRow>
        <SettingRow label="Members linked">
          <Text fontSize="sm">
            {migration.members.linkedCount} of {migration.members.activeCount}
          </Text>
        </SettingRow>
        <SettingRow label="Directory provisioning">
          <Text fontSize="sm">
            {migration.scim.status.replaceAll("-", " ")}
          </Text>
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
        previous={previous}
      />
      {migration.blockers.map((blocker) => (
        <Text key={blocker.code} fontSize="xs" color="fg.muted">
          {blocker.message}
        </Text>
      ))}
      {canManage && migration.phase !== "FINALIZED" && (
        <MigrationActions
          organizationId={organizationId}
          migration={migration}
          connectionState={connectionState}
          previous={previous}
        />
      )}
    </SettingsCard>
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
            Switch to new SSO
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
            Roll back to {previous}
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
          ? "Retry finalization"
          : "Finalize migration"}
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
        Migration progress is no longer available.
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
