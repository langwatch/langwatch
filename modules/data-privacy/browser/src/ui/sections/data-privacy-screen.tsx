/**
 * Data privacy rules configuration; the drawer is a screen-specific overlay
 * with URL state managed via ?rule=new or ?rule=<tier>:<id>:<personal>.
 */

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ScopeChipPicker,
  ScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  type ScopeChipPickerScopeType,
  type ScopeFilterValue,
} from "@langwatch/authz-browser-kit";
import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Folder, MoreVertical, Plus, Shield, UserLock } from "lucide-react";
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
import { SCOPE_ICON } from "../../model/data-privacy-labels.ts";
import { ruleSummary } from "../../model/data-privacy-rule-config.ts";
import { EffectiveSummary } from "../blocks/effective-summary.tsx";
import { PrivacyRuleDrawer, type PrivacyScopeEntry } from "../blocks/privacy-rule-drawer.tsx";

export default function DataPrivacyScreen() {
  const host = useDataPrivacyHost();
  const { projectId } = host.scope();
  // Every privacy rule is read against a project; without one in scope the page
  // renders nothing, which is what the platform page did.
  if (!projectId) return null;
  return <DataPrivacyPage host={host} projectId={projectId} />;
}

function DataPrivacyPage({ host, projectId }: { host: DataPrivacyHostApi; projectId: string }) {
  const { organizationId, teamId } = host.scope();
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
  const setForScope = dataPrivacyApi.dataPrivacy.setForScope.useMutation();

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
  const canWrite =
    !!available &&
    (!!available.organization ||
      available.departments.length > 0 ||
      available.teams.length > 0 ||
      available.projects.length > 0);

  const matchesFilter = (rule: DataPrivacyRule): boolean => {
    if (scopeFilter.kind === "all") return true;
    if (scopeFilter.kind === "team-current") {
      return rule.scopeType === "TEAM" && rule.scopeId === teamId;
    }
    if (scopeFilter.kind === "project-current") {
      return rule.scopeType === "PROJECT" && rule.scopeId === projectId;
    }
    return rule.scopeType === scopeFilter.scopeType && rule.scopeId === scopeFilter.scopeId;
  };
  const filteredRules = snapshot ? snapshot.rules.filter(matchesFilter) : [];

  const openAdd = () => setRuleAddress(PRIVACY_RULE_NEW_VALUE);
  const openEdit = (rule: DataPrivacyRule) => setRuleAddress(privacyRuleAddress(rule));
  const closeRuleDrawer = () => setRuleAddress(void 0);
  const editingRule = privacyRuleForAddress(ruleAddress, snapshot?.rules ?? []);

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

      {snapshot && snapshot.rules.length === 0 ? (
        <Card.Root width="full">
          <Card.Body>
            <EmptyState.Root width="full">
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <Shield size={24} />
                </EmptyState.Indicator>
                <VStack textAlign="center" gap={3}>
                  <VStack textAlign="center" gap={1}>
                    <EmptyState.Title>No privacy rules</EmptyState.Title>
                    <EmptyState.Description>
                      Secrets redaction and essential PII redaction are on by default, and content
                      is captured and visible to your team. Add a rule to change that at any scope.
                    </EmptyState.Description>
                  </VStack>
                  {canWrite && (
                    <Button colorPalette="blue" variant="outline" onClick={openAdd}>
                      <Plus /> Add privacy rule
                    </Button>
                  )}
                </VStack>
              </EmptyState.Content>
            </EmptyState.Root>
          </Card.Body>
        </Card.Root>
      ) : (
        snapshot && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingX={0} paddingY={0}>
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Scope</Table.ColumnHeader>
                    <Table.ColumnHeader>Rule</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredRules.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={3}>
                        <Text color="fg.muted" fontSize="sm" paddingY={2}>
                          No privacy rules at the selected scope.
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    filteredRules.map((rule) => {
                      const Icon = rule.personalOnly
                        ? UserLock
                        : (SCOPE_ICON[rule.scopeType] ?? Folder);
                      return (
                        <Table.Row key={`${rule.scopeType}:${rule.scopeId}:${rule.personalOnly}`}>
                          <Table.Cell>
                            <HStack gap={2}>
                              <Icon size={14} />
                              <Text>{rule.name}</Text>
                              <Badge size="sm" colorPalette="gray">
                                {rule.scopeType.toLowerCase()}
                              </Badge>
                              {rule.personalOnly && (
                                <Badge size="sm" colorPalette="purple">
                                  personal
                                </Badge>
                              )}
                            </HStack>
                          </Table.Cell>
                          <Table.Cell>{ruleSummary(rule.config)}</Table.Cell>
                          <Table.Cell textAlign="end">
                            {canWrite && (
                              <Menu.Root>
                                <Menu.Trigger asChild>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    aria-label={`Actions for ${rule.name} privacy rule`}
                                  >
                                    <MoreVertical size={14} />
                                  </Button>
                                </Menu.Trigger>
                                <Menu.Content>
                                  <Menu.Item value="edit" onClick={() => openEdit(rule)}>
                                    Edit
                                  </Menu.Item>
                                  <Menu.Item
                                    value="delete"
                                    color="red.500"
                                    onClick={() => void removeRule(rule)}
                                  >
                                    Delete
                                  </Menu.Item>
                                </Menu.Content>
                              </Menu.Root>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        )
      )}

      {snapshot && (
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={scopeFilter}
          currentTeamId={teamId ?? null}
        />
      )}

      {snapshot && available && (
        <PrivacyRuleDrawer
          open={ruleAddress !== void 0}
          editingRule={editingRule}
          onClose={closeRuleDrawer}
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
          onSave={async (scopes: PrivacyScopeEntry[], config) => {
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
              void invalidate();
              host.succeeded({
                title:
                  scopes.length > 1
                    ? `Privacy rule saved for ${scopes.length} scopes`
                    : "Privacy rule saved",
              });
              closeRuleDrawer();
            } catch (error) {
              host.failed({ error, fallbackTitle: "Couldn't save the privacy rule" });
            }
          }}
        />
      )}
    </VStack>
  );
}
