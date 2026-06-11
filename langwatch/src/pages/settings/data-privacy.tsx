import {
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  EmptyState,
  Field,
  Heading,
  HStack,
  Input,
  RadioGroup,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Building2,
  Folder,
  MoreVertical,
  Plus,
  Shield,
  UserLock,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import SettingsLayout from "~/components/SettingsLayout";
import {
  type AudienceFormState,
  buildRuleConfig,
  type CustomAttributeFormRow,
  configsEqual,
  configToFormState,
  EMPTY_AUDIENCE_FORM,
  inheritedFormState,
  isEmptyRuleConfig,
  ruleSummary,
  type TouchedControls,
  touchedFromConfig,
} from "~/components/settings/dataPrivacyRuleConfig";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
} from "~/components/settings/ScopeChipPicker";
import {
  type AvailableScopes,
  ScopeFilter,
} from "~/components/settings/ScopeFilter";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type {
  DataPrivacyAudienceOptions,
  DataPrivacyRule,
  DataPrivacyScopeAvailable,
} from "~/server/data-privacy/dataPrivacyPolicy.read";
import { api } from "~/utils/api";
import { isSafeRegex } from "~/utils/safeRegex";

const CATEGORY_LABELS: Record<ContentCategory, string> = {
  input: "Input",
  output: "Output",
  system: "System instructions",
  tools: "Tool calls",
};

const DISPOSITION_LABELS: Record<Disposition, string> = {
  capture: "Captured",
  restrict: "Restricted",
  drop: "Dropped",
};

const PII_LABELS: Record<PiiLevel, string> = {
  disabled: "Disabled",
  essential: "Essential",
  strict: "Strict",
};

const SCOPE_ICON: Record<string, typeof Building2> = {
  ORGANIZATION: Building2,
  DEPARTMENT: Users,
  TEAM: Users,
  PROJECT: Folder,
};

function DataPrivacySettings() {
  const { project } = useOrganizationTeamProject();
  if (!project) return null;
  return <DataPrivacyPage projectId={project.id} />;
}

export default withPermissionGuard("project:view", {
  layoutComponent: SettingsLayout,
})(DataPrivacySettings);

function DataPrivacyPage({ projectId }: { projectId: string }) {
  const utils = api.useUtils();
  const { project: currentProject, organization } =
    useOrganizationTeamProject();
  const snapshotQuery = api.dataPrivacy.getSnapshot.useQuery({ projectId });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DataPrivacyRule | null>(null);

  const available = snapshotQuery.data?.available;
  const filterAvailable = useMemo<AvailableScopes>(
    () => ({
      organization: available?.organization
        ? { id: available.organization.id, name: available.organization.name }
        : null,
      teams: available?.teams.map((t) => ({ id: t.id, name: t.name })) ?? [],
      projects:
        available?.projects.map((p) => ({ id: p.id, name: p.name })) ?? [],
    }),
    [available],
  );
  const [scopeFilter, setScopeFilter] = useUrlScopeFilter({
    filterAvailable,
    teamId: currentProject?.teamId,
    projectId,
  });

  const invalidate = () =>
    utils.dataPrivacy.getSnapshot.invalidate({ projectId });

  const setForScope = api.dataPrivacy.setForScope.useMutation();
  const removeForScope = api.dataPrivacy.removeForScope.useMutation();

  if (snapshotQuery.isLoading) {
    return (
      <SettingsLayout>
        <VStack width="full" padding={8}>
          <Spinner />
        </VStack>
      </SettingsLayout>
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
      return (
        rule.scopeType === "TEAM" && rule.scopeId === currentProject?.teamId
      );
    }
    if (scopeFilter.kind === "project-current") {
      return rule.scopeType === "PROJECT" && rule.scopeId === projectId;
    }
    return (
      rule.scopeType === scopeFilter.scopeType &&
      rule.scopeId === scopeFilter.scopeId
    );
  };
  const filteredRules = snapshot ? snapshot.rules.filter(matchesFilter) : [];

  const openAdd = () => {
    setEditingRule(null);
    setDrawerOpen(true);
  };
  const openEdit = (rule: DataPrivacyRule) => {
    setEditingRule(rule);
    setDrawerOpen(true);
  };

  const removeRule = async (rule: DataPrivacyRule) => {
    try {
      await removeForScope.mutateAsync({
        projectId,
        scope: { scopeType: rule.scopeType, scopeId: rule.scopeId },
        personalOnly: rule.personalOnly,
      });
      void invalidate();
      toaster.create({ title: "Privacy rule removed", type: "success" });
    } catch (error) {
      toaster.create({
        title: "Failed to remove rule",
        description: (error as Error).message,
        type: "error",
      });
    }
  };

  return (
    <SettingsLayout>
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
              currentTeamId={currentProject?.teamId}
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
          Control what trace content LangWatch stores, who can see it, and how
          secrets and PII are scrubbed, at any scope, inherited down to
          projects.
        </Text>

        {snapshot && <EffectiveCard effective={snapshot.effective} />}

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
                        Secrets redaction and essential PII redaction are on by
                        default, and content is captured and visible to your
                        team. Add a rule to change that at any scope.
                      </EmptyState.Description>
                    </VStack>
                    {canWrite && (
                      <Button
                        colorPalette="blue"
                        variant="outline"
                        onClick={openAdd}
                      >
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
                          <Table.Row
                            key={`${rule.scopeType}:${rule.scopeId}:${rule.personalOnly}`}
                          >
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
                                    <Menu.Item
                                      value="edit"
                                      onClick={() => openEdit(rule)}
                                    >
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

        {available && snapshot && (
          <PrivacyRuleDrawer
            open={drawerOpen}
            editingRule={editingRule}
            onClose={() => {
              setDrawerOpen(false);
              setEditingRule(null);
            }}
            available={available}
            audienceOptions={snapshot.audienceOptions}
            effective={snapshot.effective}
            projectId={projectId}
            currentTeamId={currentProject?.teamId ?? null}
            currentOrganizationId={organization?.id ?? null}
            isSaving={setForScope.isLoading}
            onSave={async (scopes, config) => {
              try {
                await Promise.all(
                  scopes.map((scope) =>
                    setForScope.mutateAsync({
                      projectId,
                      scope: {
                        scopeType: scope.scopeType,
                        scopeId: scope.scopeId,
                      },
                      personalOnly: !!scope.personalOnly,
                      config,
                    }),
                  ),
                );
                void invalidate();
                toaster.create({
                  title:
                    scopes.length > 1
                      ? `Privacy rule saved for ${scopes.length} scopes`
                      : "Privacy rule saved",
                  type: "success",
                });
                setDrawerOpen(false);
                setEditingRule(null);
              } catch (error) {
                // Partial failure leaves the already-saved scopes in place;
                // the snapshot refresh shows exactly which rows exist.
                void invalidate();
                toaster.create({
                  title: "Failed to save rule",
                  description: (error as Error).message,
                  type: "error",
                });
              }
            }}
          />
        )}
      </VStack>
    </SettingsLayout>
  );
}

function EffectiveCard({ effective }: { effective: ResolvedDataPrivacy }) {
  return (
    <Card.Root width="full">
      <Card.Header>
        <Heading as="h3" fontSize="lg">
          Effective for this project
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          What is actually applied right now, after inheriting down the scopes.
        </Text>
      </Card.Header>
      <Card.Body>
        <VStack gap={2} align="stretch">
          {CONTENT_CATEGORIES.map((category) => (
            <HStack key={category} justifyContent="space-between">
              <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
              <Text>
                {DISPOSITION_LABELS[effective.categories[category].disposition]}
              </Text>
            </HStack>
          ))}
          {effective.customAttributes.length > 0 && (
            <HStack justifyContent="space-between">
              <Text color="fg.muted">Attribute rules</Text>
              <Text>
                {effective.customAttributes
                  .map(
                    (rule) =>
                      `${rule.pattern} ${
                        rule.disposition === "drop" ? "dropped" : "restricted"
                      }`,
                  )
                  .join(" · ")}
              </Text>
            </HStack>
          )}
          <HStack justifyContent="space-between">
            <Text color="fg.muted">PII redaction</Text>
            <Text>{PII_LABELS[effective.pii.level]}</Text>
          </HStack>
          <HStack justifyContent="space-between">
            <Text color="fg.muted">Secrets redaction</Text>
            <Text>
              {effective.secrets.enabled ? "On" : "Off"}
              {effective.secrets.customPatterns.length > 0
                ? ` · ${effective.secrets.customPatterns.length} custom ${
                    effective.secrets.customPatterns.length === 1
                      ? "pattern"
                      : "patterns"
                  }`
                : ""}
            </Text>
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

const dispositionCollection = createListCollection({
  items: [
    { value: "capture", label: "Captured" },
    { value: "restrict", label: "Restricted" },
    { value: "drop", label: "Dropped" },
  ],
});

const attributeDispositionCollection = createListCollection({
  items: [
    { value: "restrict", label: "Restricted" },
    { value: "drop", label: "Dropped" },
  ],
});

const NO_CONTROLS_TOUCHED: TouchedControls = {
  categories: {},
  pii: false,
  secrets: false,
};

function describeAudienceSelection(
  audience: AudienceFormState,
  options: DataPrivacyAudienceOptions,
): string {
  const parts: string[] = [];
  if (audience.admins) parts.push("Admins");
  if (audience.allMembers) parts.push("All members");
  if (audience.viewers) parts.push("Viewers");
  if (audience.projectOwner) parts.push("the project owner");
  for (const id of audience.groupIds) {
    parts.push(options.groups.find((g) => g.id === id)?.name ?? "a group");
  }
  for (const id of audience.departmentIds) {
    parts.push(
      options.departments.find((d) => d.id === id)?.name ?? "a department",
    );
  }
  return parts.length > 0
    ? `Visible to: ${parts.join(", ")}`
    : "No one (fully hidden)";
}

function secretPatternError(pattern: string): string | null {
  if (pattern.trim().length === 0) return null;
  try {
    new RegExp(pattern);
  } catch {
    return "Invalid regular expression";
  }
  if (!isSafeRegex(pattern)) {
    return "Pattern could backtrack catastrophically; simplify it";
  }
  return null;
}

function attributePatternError(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.replaceAll("*", "").length === 0) {
    return "Name at least part of the key";
  }
  return null;
}

function PrivacyRuleDrawer({
  open,
  editingRule,
  onClose,
  available,
  audienceOptions,
  effective,
  projectId,
  currentTeamId,
  currentOrganizationId,
  isSaving,
  onSave,
}: {
  open: boolean;
  editingRule: DataPrivacyRule | null;
  onClose: () => void;
  available: DataPrivacyScopeAvailable;
  audienceOptions: DataPrivacyAudienceOptions;
  effective: ResolvedDataPrivacy;
  projectId: string;
  currentTeamId: string | null;
  currentOrganizationId: string | null;
  isSaving: boolean;
  onSave: (scopes: ScopeChipPickerEntry[], config: DataPrivacyConfig) => void;
}) {
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [dispositions, setDispositions] = useState<
    Record<ContentCategory, Disposition>
  >({
    input: "capture",
    output: "capture",
    system: "capture",
    tools: "capture",
  });
  const [audience, setAudience] = useState<AudienceFormState>({
    ...EMPTY_AUDIENCE_FORM,
    admins: true,
  });
  const [piiLevel, setPiiLevel] = useState<PiiLevel>("essential");
  const [secretsEnabled, setSecretsEnabled] = useState(true);
  const [secretsPatterns, setSecretsPatterns] = useState<string[]>([]);
  const [customAttributes, setCustomAttributes] = useState<
    CustomAttributeFormRow[]
  >([]);
  // Controls the user explicitly changed, so they persist as overrides. On an
  // edit it starts as the rule's existing fields, so they re-persist untouched.
  const [touched, setTouched] = useState<TouchedControls>(NO_CONTROLS_TOUCHED);
  // Read inside the scope-change effect without re-deriving on every touch.
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  const touchCategory = (category: ContentCategory) =>
    setTouched((prev) => ({
      ...prev,
      categories: { ...prev.categories, [category]: true },
    }));
  const touchRestrictedCategories = () =>
    setTouched((prev) => {
      const categories = { ...prev.categories };
      for (const c of CONTENT_CATEGORIES) {
        if (dispositions[c] === "restrict") categories[c] = true;
      }
      return { ...prev, categories };
    });

  const isCurrentProjectScope =
    scopes.length === 1 &&
    scopes[0]!.scopeType === "PROJECT" &&
    scopes[0]!.scopeId === projectId &&
    !scopes[0]!.personalOnly;

  const applyForm = (form: ReturnType<typeof configToFormState>) => {
    setDispositions(form.dispositions);
    setAudience(form.audience);
    setPiiLevel(form.piiLevel);
    setSecretsEnabled(form.secretsEnabled);
    setSecretsPatterns(form.secretsPatterns);
    setCustomAttributes(form.customAttributes);
  };

  // Open transition: seed the drawer. Edit prefills from the rule and marks its
  // existing fields touched so they re-persist. Add prefills from the values the
  // new rule would inherit (the current-project scope shows the resolved
  // effective; any other scope the platform defaults), with nothing touched yet,
  // so the user sees the parent restriction they're about to override.
  useEffect(() => {
    if (!open) return;
    if (editingRule) {
      setScopes([
        {
          scopeType: editingRule.scopeType,
          scopeId: editingRule.scopeId,
          ...(editingRule.personalOnly ? { personalOnly: true } : {}),
        },
      ]);
      applyForm(configToFormState(editingRule.config));
      const editTouched = touchedFromConfig(editingRule.config);
      setTouched(editTouched);
      touchedRef.current = editTouched;
      return;
    }
    const projectInAvailable = available.projects.some(
      (p) => p.id === projectId,
    );
    const initialScopes: ScopeChipPickerEntry[] = projectInAvailable
      ? [{ scopeType: "PROJECT", scopeId: projectId }]
      : [];
    setScopes(initialScopes);
    setTouched(NO_CONTROLS_TOUCHED);
    touchedRef.current = NO_CONTROLS_TOUCHED;
    applyForm(
      inheritedFormState({
        effective,
        isCurrentProjectScope: projectInAvailable,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule]);

  // Re-derive the Add baseline when the user switches scope before touching
  // anything; once a control is touched their choices stand and aren't clobbered.
  useEffect(() => {
    if (!open || editingRule) return;
    const t = touchedRef.current;
    const anyTouched =
      t.pii || t.secrets || Object.values(t.categories).some(Boolean);
    if (anyTouched) return;
    applyForm(inheritedFormState({ effective, isCurrentProjectScope }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentProjectScope]);

  const anyRestrict =
    CONTENT_CATEGORIES.some((c) => dispositions[c] === "restrict") ||
    customAttributes.some((row) => row.disposition === "restrict");

  const config = useMemo<DataPrivacyConfig>(
    () =>
      buildRuleConfig({
        dispositions,
        audience,
        piiLevel,
        secretsEnabled,
        secretsPatterns,
        customAttributes,
        touched,
      }),
    [
      dispositions,
      audience,
      piiLevel,
      secretsEnabled,
      secretsPatterns,
      customAttributes,
      touched,
    ],
  );

  const hasInvalidPatterns =
    secretsPatterns.some((p) => secretPatternError(p) !== null) ||
    customAttributes.some((row) => attributePatternError(row.pattern) !== null);

  // Add: enabled once the built config persists at least one control. Edit:
  // enabled once the built config differs from the rule being edited.
  const hasChange = editingRule
    ? !configsEqual(config, editingRule.config)
    : !isEmptyRuleConfig(config);
  const canSave =
    scopes.length > 0 && hasChange && !hasInvalidPatterns && !isSaving;

  const editIcon = editingRule
    ? editingRule.personalOnly
      ? UserLock
      : (SCOPE_ICON[editingRule.scopeType] ?? Folder)
    : null;
  const EditIcon = editIcon;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">
            {editingRule ? "Edit privacy rule" : "Add privacy rule"}
          </Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            {editingRule && EditIcon ? (
              <VStack gap={1.5} align="start">
                <Text fontWeight="600" fontSize="sm">
                  Scope
                </Text>
                <HStack gap={2}>
                  <EditIcon size={14} />
                  <Text fontSize="sm">{editingRule.name}</Text>
                  <Badge size="sm" colorPalette="gray">
                    {editingRule.scopeType.toLowerCase()}
                  </Badge>
                  {editingRule.personalOnly && (
                    <Badge size="sm" colorPalette="purple">
                      personal
                    </Badge>
                  )}
                </HStack>
              </VStack>
            ) : (
              <ScopeChipPicker<ScopeChipPickerScopeType>
                value={scopes}
                onChange={setScopes}
                organizationId={available.organization?.id}
                organizationName={available.organization?.name}
                availableTeams={available.teams}
                availableProjects={available.projects}
                availableDepartments={available.departments}
                allowedScopeTypes={[
                  "ORGANIZATION",
                  "DEPARTMENT",
                  "TEAM",
                  "PROJECT",
                ]}
                personalScopes
                currentOrganizationId={currentOrganizationId}
                currentTeamId={currentTeamId}
                currentProjectId={projectId}
              />
            )}

            <VStack gap={2.5} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Content
              </Text>
              {CONTENT_CATEGORIES.map((category) => (
                <HStack key={category} justifyContent="space-between" gap={4}>
                  <Text fontSize="sm">{CATEGORY_LABELS[category]}</Text>
                  <Select.Root
                    collection={dispositionCollection}
                    value={[dispositions[category]]}
                    size="sm"
                    width="200px"
                    onValueChange={(d) => {
                      setDispositions((prev) => ({
                        ...prev,
                        [category]: (d.value[0] as Disposition) ?? "capture",
                      }));
                      touchCategory(category);
                    }}
                  >
                    <Select.Trigger
                      background="bg"
                      aria-label={CATEGORY_LABELS[category]}
                    >
                      <Select.ValueText />
                    </Select.Trigger>
                    <Select.Content>
                      {dispositionCollection.items.map((item) => (
                        <Select.Item key={item.value} item={item}>
                          {item.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </HStack>
              ))}
              <Text fontSize="xs" color="fg.muted">
                Captured content is stored and visible to the audience below
                when restricted; dropped content is stripped at ingestion and
                cannot be recovered.
              </Text>
            </VStack>

            <VStack gap={2} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Custom attributes
              </Text>
              {customAttributes.map((row, index) => {
                const error = attributePatternError(row.pattern);
                return (
                  <VStack key={index} gap={1} align="stretch">
                    <HStack gap={2}>
                      <Input
                        size="sm"
                        fontFamily="mono"
                        placeholder="gen_ai.prompt.*"
                        value={row.pattern}
                        aria-label={`Attribute pattern ${index + 1}`}
                        borderColor={error ? "red.500" : undefined}
                        onChange={(e) =>
                          setCustomAttributes((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, pattern: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <Select.Root
                        collection={attributeDispositionCollection}
                        value={[row.disposition]}
                        size="sm"
                        width="140px"
                        onValueChange={(d) =>
                          setCustomAttributes((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    disposition:
                                      (d.value[0] as "restrict" | "drop") ??
                                      "restrict",
                                  }
                                : r,
                            ),
                          )
                        }
                      >
                        <Select.Trigger
                          background="bg"
                          aria-label={`Attribute disposition ${index + 1}`}
                        >
                          <Select.ValueText />
                        </Select.Trigger>
                        <Select.Content>
                          {attributeDispositionCollection.items.map((item) => (
                            <Select.Item key={item.value} item={item}>
                              {item.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove attribute rule ${index + 1}`}
                        onClick={() =>
                          setCustomAttributes((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={14} />
                      </Button>
                    </HStack>
                    {error && (
                      <Text fontSize="xs" color="red.500">
                        {error}
                      </Text>
                    )}
                  </VStack>
                );
              })}
              <Box>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setCustomAttributes((prev) => [
                      ...prev,
                      { pattern: "", disposition: "restrict" },
                    ])
                  }
                >
                  <Plus size={14} /> Add attribute rule
                </Button>
              </Box>
              <Text fontSize="xs" color="fg.muted">
                Match span attribute keys beyond the four categories, with *
                wildcards: restricted attributes are hidden from outside the
                audience, dropped ones are stripped at ingestion.
              </Text>
            </VStack>

            {anyRestrict && (
              <VStack gap={2} align="stretch">
                <Text fontWeight="600" fontSize="sm">
                  Restricted content is visible to
                </Text>
                <VStack gap={1.5} align="start">
                  <Checkbox
                    checked={audience.admins}
                    onCheckedChange={({ checked }) => {
                      setAudience((prev) => ({
                        ...prev,
                        admins: checked === true,
                      }));
                      touchRestrictedCategories();
                    }}
                  >
                    Admins
                  </Checkbox>
                  <Checkbox
                    checked={audience.allMembers}
                    onCheckedChange={({ checked }) => {
                      setAudience((prev) => ({
                        ...prev,
                        allMembers: checked === true,
                      }));
                      touchRestrictedCategories();
                    }}
                  >
                    All members
                  </Checkbox>
                  <Checkbox
                    checked={audience.viewers}
                    onCheckedChange={({ checked }) => {
                      setAudience((prev) => ({
                        ...prev,
                        viewers: checked === true,
                      }));
                      touchRestrictedCategories();
                    }}
                  >
                    Viewers
                  </Checkbox>
                  <Checkbox
                    checked={audience.projectOwner}
                    onCheckedChange={({ checked }) => {
                      setAudience((prev) => ({
                        ...prev,
                        projectOwner: checked === true,
                      }));
                      touchRestrictedCategories();
                    }}
                  >
                    Only the project owner (their own personal projects)
                  </Checkbox>
                </VStack>
                {audienceOptions.groups.length > 0 && (
                  <AudienceMultiSelect
                    label="Groups"
                    options={audienceOptions.groups}
                    selected={audience.groupIds}
                    onChange={(groupIds) => {
                      setAudience((prev) => ({ ...prev, groupIds }));
                      touchRestrictedCategories();
                    }}
                  />
                )}
                {audienceOptions.departments.length > 0 && (
                  <AudienceMultiSelect
                    label="Departments"
                    options={audienceOptions.departments}
                    selected={audience.departmentIds}
                    onChange={(departmentIds) => {
                      setAudience((prev) => ({ ...prev, departmentIds }));
                      touchRestrictedCategories();
                    }}
                  />
                )}
                <Text fontSize="xs" color="fg.muted">
                  {describeAudienceSelection(audience, audienceOptions)}
                </Text>
              </VStack>
            )}

            <Field.Root>
              <Field.Label>PII redaction</Field.Label>
              <RadioGroup.Root
                value={piiLevel}
                onValueChange={(d) => {
                  setPiiLevel((d.value as PiiLevel) ?? "essential");
                  setTouched((prev) => ({ ...prev, pii: true }));
                }}
              >
                <VStack align="start" gap={1}>
                  <RadioGroup.Item value="disabled">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>Disabled</RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="essential">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Essential (fast, in-process: emails, phones, cards, IDs)
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="strict">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Strict (adds names and locations, uses the analysis
                      service)
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                </VStack>
              </RadioGroup.Root>
            </Field.Root>

            <VStack gap={2} align="stretch">
              <HStack gap={3} align="start">
                <Switch
                  checked={secretsEnabled}
                  onCheckedChange={({ checked }) => {
                    setSecretsEnabled(checked === true);
                    setTouched((prev) => ({ ...prev, secrets: true }));
                  }}
                />
                <VStack align="start" gap={0}>
                  <Text fontWeight="600" fontSize="sm">
                    Secrets redaction
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    Scrubs API keys, tokens, private keys, and database URLs. On
                    by default.
                  </Text>
                </VStack>
              </HStack>
              {secretsEnabled && (
                <VStack gap={2} align="stretch" paddingLeft={10}>
                  {secretsPatterns.map((pattern, index) => {
                    const error = secretPatternError(pattern);
                    return (
                      <VStack key={index} gap={1} align="stretch">
                        <HStack gap={2}>
                          <Input
                            size="sm"
                            fontFamily="mono"
                            placeholder="acme_live_[a-z0-9]+"
                            value={pattern}
                            aria-label={`Custom secret pattern ${index + 1}`}
                            borderColor={error ? "red.500" : undefined}
                            onChange={(e) => {
                              setSecretsPatterns((prev) =>
                                prev.map((p, i) =>
                                  i === index ? e.target.value : p,
                                ),
                              );
                              setTouched((prev) => ({
                                ...prev,
                                secrets: true,
                              }));
                            }}
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Remove custom secret pattern ${
                              index + 1
                            }`}
                            onClick={() => {
                              setSecretsPatterns((prev) =>
                                prev.filter((_, i) => i !== index),
                              );
                              setTouched((prev) => ({
                                ...prev,
                                secrets: true,
                              }));
                            }}
                          >
                            <X size={14} />
                          </Button>
                        </HStack>
                        {error && (
                          <Text fontSize="xs" color="red.500">
                            {error}
                          </Text>
                        )}
                      </VStack>
                    );
                  })}
                  <Box>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setSecretsPatterns((prev) => [...prev, ""]);
                        setTouched((prev) => ({ ...prev, secrets: true }));
                      }}
                    >
                      <Plus size={14} /> Add custom pattern
                    </Button>
                  </Box>
                  <Text fontSize="xs" color="fg.muted">
                    Extra regular expressions redacted on top of the built-in
                    catalog.
                  </Text>
                </VStack>
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end">
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => {
                if (scopes.length === 0) return;
                onSave(scopes, config);
              }}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function AudienceMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const collection = useMemo(
    () =>
      createListCollection({
        items: options.map((o) => ({ value: o.id, label: o.name })),
      }),
    [options],
  );
  return (
    <Field.Root>
      <Field.Label fontSize="sm">{label}</Field.Label>
      <Select.Root
        collection={collection}
        value={selected}
        multiple
        size="sm"
        onValueChange={(d) => onChange(d.value)}
      >
        <Select.Trigger background="bg" aria-label={label}>
          <Select.ValueText placeholder={`Pick ${label.toLowerCase()}`} />
        </Select.Trigger>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}
