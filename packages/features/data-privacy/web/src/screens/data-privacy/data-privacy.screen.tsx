/**
 * Data privacy rules, as a reader configures them.
 *
 * `platform/app/src/pages/settings/data-privacy.tsx`, moved whole, together
 * with `components/settings/DataPrivacyRuleDrawer.tsx` — the URL shell that
 * rebuilt the drawer from the address. What changed is only what a feature-web
 * package may not own:
 *
 * - `SettingsLayout` does not travel. Chrome belongs to the route tree, and
 *   `apps/ui` mounts the harvested settings layout around this screen.
 * - `withPermissionGuard("project:view")` does not travel either; the frontend
 *   feature states the same policy in front of the same loader.
 * - The organization, the team, the project, the address and both toasts are
 *   the host's.
 * - THE DRAWER IS THIS SCREEN'S OWN OVERLAY, not a registry entry. It had
 *   exactly one opener — this page — so the `dataPrivacyRule` registration and
 *   its lazy shell die with the move, and the address becomes `?rule=`. The
 *   spec asks that the URL carry the drawer and the rule it targets, and it
 *   still does: `?rule=new` for the add flow, `?rule=<tier>:<id>:<personal>`
 *   for one rule, cleared on close. That is the gateway family's answer to the
 *   same question, third use.
 *
 * Spec: specs/data-privacy/privacy-rule-drawer-url.feature
 * Spec: specs/data-privacy/policy-configuration.feature
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
} from "@langwatch/authz-web/surfaces/scope-picker";
import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Folder, MoreVertical, Plus, Shield, UserLock } from "lucide-react";
import { useMemo } from "react";
import { dataPrivacyApi } from "../../behavior/data-privacy-api";
import { useDataPrivacyHost, type DataPrivacyHostPort } from "../../model/data-privacy-host";
import { SCOPE_ICON } from "../../model/data-privacy-labels";
import { ruleSummary } from "../../model/data-privacy-rule-config";
import { EffectiveSummary } from "../../ui/blocks/effective-summary";
import { PrivacyRuleDrawer, type PrivacyScopeEntry } from "../../ui/blocks/privacy-rule-drawer";

/** The query parameter the scope filter lives in. Unchanged from the page. */
export const PRIVACY_SCOPE_QUERY_KEY = "scope";

/** The query parameter that carries the open rule drawer. */
export const PRIVACY_RULE_QUERY_KEY = "rule";

/** The value `?rule=` takes for the add flow, which targets no rule yet. */
export const PRIVACY_RULE_NEW_VALUE = "new";

/** The address of one rule: its tier, its id, and whether it is the personal variant. */
export function privacyRuleAddress(rule: {
  scopeType: string;
  scopeId: string;
  personalOnly: boolean;
}): string {
  return `${rule.scopeType}:${rule.scopeId}:${String(rule.personalOnly)}`;
}

/**
 * The rule an address names, out of the rules the reader can see.
 *
 * Nothing is fetched to answer this: the snapshot the page already read carries
 * every readable rule, which is what let the platform drawer rebuild itself
 * from a pasted link and is what lets this one do the same.
 */
export function privacyRuleForAddress(
  address: string | undefined,
  rules: readonly DataPrivacyRule[],
): DataPrivacyRule | null {
  if (!address || address === PRIVACY_RULE_NEW_VALUE) return null;
  return rules.find((rule) => privacyRuleAddress(rule) === address) ?? null;
}

export default function DataPrivacyScreen() {
  const host = useDataPrivacyHost();
  const { projectId } = host.scope();
  // Every privacy rule is read against a project; without one in scope the page
  // renders nothing, which is what the platform page did.
  if (!projectId) return null;
  return <DataPrivacyPage host={host} projectId={projectId} />;
}

function DataPrivacyPage({ host, projectId }: { host: DataPrivacyHostPort; projectId: string }) {
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
