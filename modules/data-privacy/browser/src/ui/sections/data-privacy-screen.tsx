/**
 * Data privacy rules configuration; the drawer is a screen-specific overlay
 * with URL state managed via ?rule=new or ?rule=<tier>:<id>:<personal>.
 */

import { Button, Heading, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  ScopeChipPicker,
  ScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  type ScopeChipPickerScopeType,
  type ScopeFilterValue,
} from "@langwatch/authz-browser-kit";
import type {
  DataPrivacyConfig,
  DataPrivacyRule,
  DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import { useMemo } from "react";

import { dataPrivacyApi } from "../../behavior/data-privacy-api.ts";
import {
  PRIVACY_RULE_NEW_VALUE,
  PRIVACY_RULE_QUERY_KEY,
  PRIVACY_SCOPE_QUERY_KEY,
  privacyRuleAddress,
  privacyRuleForAddress,
} from "../../model/data-privacy-address.ts";
import { useDataPrivacyHost, type DataPrivacyHostApi } from "../../model/data-privacy-host.ts";
import {
  canWritePrivacyRules,
  ruleMatchesScopeFilter,
} from "../../model/data-privacy-rule-filter.ts";
import { EffectiveSummary } from "../blocks/effective-summary.tsx";
import { NoPrivacyRules } from "../blocks/no-privacy-rules.tsx";
import { PrivacyRuleDrawer, type PrivacyScopeEntry } from "../blocks/privacy-rule-drawer.tsx";
import { PrivacyRulesTable } from "../blocks/privacy-rules-table.tsx";

export default function DataPrivacyScreen() {
  const host = useDataPrivacyHost();
  const { projectId } = host.scope();
  // Every privacy rule is read against a project; without one in scope the page
  // renders nothing, which is what the platform page did.
  if (!projectId) return null;
  return <DataPrivacyPage host={host} projectId={projectId} />;
}

function DataPrivacyPage({ host, projectId }: { host: DataPrivacyHostApi; projectId: string }) {
  const { teamId } = host.scope();
  const utils = dataPrivacyApi.useUtils();
  const snapshotQuery = dataPrivacyApi.dataPrivacy.getSnapshot.useQuery({ projectId });

  const available = snapshotQuery.data?.available;
  const filterAvailable = useMemo(
    () => ({
      organization: available?.organization
        ? { id: available.organization.id, name: available.organization.name }
        : null,
      teams: available?.teams.map((team) => ({ id: team.id, name: team.name })) ?? [],
      projects:
        available?.projects.map((project) => ({
          id: project.id,
          name: project.name,
          teamId: project.teamId,
        })) ?? [],
    }),
    [available],
  );

  const query = host.route().query;
  const scopeFilter = scopeFilterFromAddress({
    raw: query[PRIVACY_SCOPE_QUERY_KEY],
    available: filterAvailable,
  });
  const setScopeFilter = (next: ScopeFilterValue) => {
    const write = scopeFilterAddressWrite(next, { teamId, projectId });
    if (write.kind === "keep") return;
    host.setQuery(
      {
        ...query,
        [PRIVACY_SCOPE_QUERY_KEY]: write.kind === "set" ? write.value : void 0,
      },
      { replace: true },
    );
  };

  const invalidate = () => utils.dataPrivacy.getSnapshot.invalidate({ projectId });

  const removeForScope = dataPrivacyApi.dataPrivacy.removeForScope.useMutation();

  const ruleAddress = query[PRIVACY_RULE_QUERY_KEY];
  const setRuleAddress = (next: string | undefined) =>
    host.setQuery({ ...query, [PRIVACY_RULE_QUERY_KEY]: next });

  if (snapshotQuery.isLoading) {
    return (
      <VStack width="full" padding={8}>
        <Spinner />
      </VStack>
    );
  }

  const snapshot = snapshotQuery.data;
  const canWrite = canWritePrivacyRules(available);
  const filteredRules = (snapshot?.rules ?? []).filter((rule) =>
    ruleMatchesScopeFilter({ rule, filter: scopeFilter, teamId, projectId }),
  );

  const openAdd = () => setRuleAddress(PRIVACY_RULE_NEW_VALUE);
  const openEdit = (rule: DataPrivacyRule) => setRuleAddress(privacyRuleAddress(rule));
  const closeRuleDrawer = () => setRuleAddress(void 0);

  const removeRule = async (rule: DataPrivacyRule) => {
    try {
      await removeForScope.mutateAsync({
        projectId,
        scope: { scopeType: rule.scopeType, scopeId: rule.scopeId },
        personalOnly: rule.personalOnly,
      });
      void invalidate();
      host.succeeded({ title: "Privacy rule removed" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove this rule" });
    }
  };

  return (
    <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
      <HStack width="full" marginTop={2}>
        <Heading as="h2" fontSize="xl">
          Data Privacy
        </Heading>
        <Spacer />
        {snapshot && snapshot.rules.length > 0 && (
          <ScopeFilter
            value={scopeFilter}
            onChange={setScopeFilter}
            available={filterAvailable}
            currentTeamId={teamId}
            currentProjectId={projectId}
          />
        )}
        {canWrite && (
          <Button colorPalette="blue" onClick={openAdd}>
            Add privacy rule
          </Button>
        )}
      </HStack>

      <Text fontSize="sm" color="fg.muted">
        Control what trace content LangWatch stores, who can see it, and how secrets and PII are
        scrubbed, at any scope, inherited down to projects.
      </Text>

      {snapshot && snapshot.rules.length === 0 && (
        <NoPrivacyRules canWrite={canWrite} onAdd={openAdd} />
      )}
      {snapshot && snapshot.rules.length > 0 && (
        <PrivacyRulesTable
          rules={filteredRules}
          canWrite={canWrite}
          onEdit={openEdit}
          onRemove={(rule) => void removeRule(rule)}
        />
      )}

      {snapshot && (
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={scopeFilter}
          currentTeamId={teamId ?? null}
        />
      )}

      {snapshot && available && (
        <PrivacyRuleDrawerMount
          host={host}
          projectId={projectId}
          snapshot={snapshot}
          open={ruleAddress !== void 0}
          editingRule={privacyRuleForAddress(ruleAddress, snapshot.rules)}
          onClose={closeRuleDrawer}
          onSaved={() => void invalidate()}
        />
      )}
    </VStack>
  );
}

/** The drawer over the page's snapshot, saving one rule per picked scope. */
function PrivacyRuleDrawerMount({
  host,
  projectId,
  snapshot,
  open,
  editingRule,
  onClose,
  onSaved,
}: {
  host: DataPrivacyHostApi;
  projectId: string;
  snapshot: DataPrivacySnapshot;
  open: boolean;
  editingRule: DataPrivacyRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { organizationId, teamId } = host.scope();
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();
  const available = snapshot.available;

  const save = async (scopes: PrivacyScopeEntry[], config: DataPrivacyConfig) => {
    try {
      await Promise.all(
        scopes.map((scope) =>
          setForScope.mutateAsync({
            projectId,
            scope: { scopeType: scope.scopeType, scopeId: scope.scopeId },
            personalOnly: !!scope.personalOnly,
            config,
          }),
        ),
      );
      onSaved();
      host.succeeded({ title: savedTitle(scopes.length) });
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't save the privacy rule" });
    }
  };

  return (
    <PrivacyRuleDrawer
      open={open}
      editingRule={editingRule}
      onClose={onClose}
      available={available}
      audienceOptions={snapshot.audienceOptions}
      effectiveTeam={snapshot.effectiveTeam}
      effectiveOrganization={snapshot.effectiveOrganization}
      projectId={projectId}
      isSaving={setForScope.isPending}
      scopePicker={({ value, onChange }) => (
        <ScopeChipPicker<ScopeChipPickerScopeType>
          value={value}
          onChange={onChange}
          organizationId={available.organization?.id}
          organizationName={available.organization?.name}
          availableTeams={available.teams}
          availableProjects={available.projects}
          availableDepartments={available.departments}
          allowedScopeTypes={["ORGANIZATION", "DEPARTMENT", "TEAM", "PROJECT"]}
          personalScopes
          currentOrganizationId={organizationId ?? null}
          currentTeamId={teamId ?? null}
          currentProjectId={projectId}
        />
      )}
      onSave={save}
    />
  );
}

function savedTitle(scopeCount: number): string {
  return scopeCount > 1 ? `Privacy rule saved for ${scopeCount} scopes` : "Privacy rule saved";
}
