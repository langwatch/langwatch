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
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Building2,
  Eye,
  Folder,
  HelpCircle,
  MoreVertical,
  Plus,
  Shield,
  User,
  UserLock,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import SettingsLayout from "~/components/SettingsLayout";
import {
  ALL_MEMBERS_VALUE,
  type AudienceFormState,
  applyAudienceSelection,
  audienceToSelection,
  buildRuleConfig,
  type CustomAttributeFormRow,
  configsEqual,
  configToFormState,
  EMPTY_AUDIENCE_FORM,
  inheritedFormState,
  isEmptyRuleConfig,
  PROJECT_OWNER_VALUE,
  ROLE_VALUES,
  ruleSummary,
  selectionToAudience,
  type TouchedControls,
  touchedFromConfig,
} from "~/components/settings/dataPrivacyRuleConfig";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  ESSENTIAL_PII_SUMMARY,
  STRICT_ADDED_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_SUMMARY,
} from "~/components/settings/piiEntityLabels";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
} from "~/components/settings/ScopeChipPicker";
import {
  type AvailableScopes,
  ScopeFilter,
  type ScopeFilter as ScopeFilterValue,
} from "~/components/settings/ScopeFilter";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
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
  DataPrivacySnapshot,
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
  custom: "Custom",
};

/**
 * A labeled group of PII identifier checkboxes for the custom level. One group
 * for the natively-detected identifiers and one for the ones that need the
 * analysis service, so the customer sees the cost trade-off of each selection.
 */
function PiiEntityToggleGroup({
  title,
  hint,
  labels,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  labels: Record<string, string>;
  selected: string[];
  onToggle: (entity: string) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <VStack align="stretch" gap={1.5}>
      <VStack align="start" gap={0}>
        <Text fontWeight="600" fontSize="xs">
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </VStack>
      <SimpleGrid columns={2} gap={1} columnGap={4}>
        {Object.entries(labels).map(([entity, label]) => (
          <Checkbox
            key={entity}
            size="sm"
            checked={selectedSet.has(entity)}
            onCheckedChange={() => onToggle(entity)}
          >
            <Text fontSize="xs">{label}</Text>
          </Checkbox>
        ))}
      </SimpleGrid>
    </VStack>
  );
}

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

        {snapshot && (
          <EffectiveSummary
            snapshot={snapshot}
            scopeFilter={scopeFilter}
            currentTeamId={currentProject?.teamId ?? null}
          />
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

/**
 * The effective view follows the scope filter: "All you can see" shows the
 * organization baseline, "This team" the team baseline, and a project the full
 * cascade. Team/org baselines are null for a personal-account project, which
 * falls back to its own project policy.
 */
function pickEffectiveForScope(
  snapshot: DataPrivacySnapshot,
  scopeFilter: ScopeFilterValue,
  currentTeamId: string | null,
): { effective: ResolvedDataPrivacy; scopeLabel: string } {
  if (scopeFilter.kind === "all" && snapshot.effectiveOrganization) {
    return {
      effective: snapshot.effectiveOrganization,
      scopeLabel: "this organization",
    };
  }
  const isCurrentTeam =
    scopeFilter.kind === "team-current" ||
    (scopeFilter.kind === "specific" &&
      scopeFilter.scopeType === "TEAM" &&
      scopeFilter.scopeId === currentTeamId);
  if (isCurrentTeam && snapshot.effectiveTeam) {
    return { effective: snapshot.effectiveTeam, scopeLabel: "this team" };
  }
  return { effective: snapshot.effective, scopeLabel: "this project" };
}

export function EffectiveSummary({
  snapshot,
  scopeFilter,
  currentTeamId,
}: {
  snapshot: DataPrivacySnapshot;
  scopeFilter: ScopeFilterValue;
  currentTeamId: string | null;
}) {
  const { effective, scopeLabel } = pickEffectiveForScope(
    snapshot,
    scopeFilter,
    currentTeamId,
  );
  const piiValue =
    effective.pii.level === "custom"
      ? `Custom (${effective.pii.entities.length} ${
          effective.pii.entities.length === 1 ? "type" : "types"
        })`
      : PII_LABELS[effective.pii.level];
  const secretsValue = `${effective.secrets.enabled ? "On" : "Off"}${
    effective.secrets.customPatterns.length > 0
      ? ` · ${effective.secrets.customPatterns.length} custom ${
          effective.secrets.customPatterns.length === 1 ? "pattern" : "patterns"
        }`
      : ""
  }`;
  const effectiveRows: Array<{ term: string; value: string }> = [
    ...CONTENT_CATEGORIES.map((category) => ({
      term: CATEGORY_LABELS[category],
      value: DISPOSITION_LABELS[effective.categories[category].disposition],
    })),
    ...(effective.customAttributes.length > 0
      ? [
          {
            term: "Attribute rules",
            value: effective.customAttributes
              .map(
                (rule) =>
                  `${rule.pattern} ${
                    rule.disposition === "drop" ? "dropped" : "restricted"
                  }`,
              )
              .join(" · "),
          },
        ]
      : []),
    { term: "PII redaction", value: piiValue },
    { term: "Secrets redaction", value: secretsValue },
  ];
  return (
    <VStack gap={3} align="stretch" width="full" paddingTop={2}>
      <VStack gap={0} align="start">
        <Heading as="h3" fontSize="lg">
          Effective for {scopeLabel}
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          What is actually applied, after the rules above cascade down.
        </Text>
      </VStack>
      <Table.Root variant="line" size="sm" width="full">
        <Table.Body>
          {effectiveRows.map(({ term, value }) => (
            <Table.Row key={term}>
              <Table.Cell color="fg.muted">{term}</Table.Cell>
              <Table.Cell textAlign="end">{value}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </VStack>
  );
}

const dispositionCollection = createListCollection({
  items: [
    {
      value: "capture",
      label: "Captured",
      description: "Stored and visible to your team.",
    },
    {
      value: "restrict",
      label: "Restricted",
      description: "Stored, visible only to the audience below.",
    },
    {
      value: "drop",
      label: "Dropped",
      description: "Stripped at ingestion, cannot be recovered.",
    },
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
  if (audience.allMembers) parts.push("All members");
  if (audience.projectOwner) parts.push("project owners");
  if (audience.admins) parts.push("Admins");
  if (audience.members) parts.push("Members");
  if (audience.viewers) parts.push("Viewers");
  for (const id of audience.groupIds) {
    parts.push(options.groups.find((g) => g.id === id)?.name ?? "a group");
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
  const [piiEntities, setPiiEntities] = useState<string[]>([]);
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
  // Remember the last enabled PII level so toggling redaction off and back on
  // restores the chosen level instead of silently dropping Strict to Essential.
  const lastEnabledPiiLevel = useRef<PiiLevel>("essential");
  useEffect(() => {
    if (piiLevel !== "disabled") lastEnabledPiiLevel.current = piiLevel;
  }, [piiLevel]);

  const togglePiiEntity = (entity: string) => {
    setPiiEntities((prev) =>
      prev.includes(entity)
        ? prev.filter((e) => e !== entity)
        : [...prev, entity],
    );
    setTouched((prev) => ({ ...prev, pii: true }));
  };

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
    setPiiEntities(form.piiEntities);
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
        piiEntities,
        secretsEnabled,
        secretsPatterns,
        customAttributes,
        touched,
      }),
    [
      dispositions,
      audience,
      piiLevel,
      piiEntities,
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
                          <VStack align="start" gap={0}>
                            <Text fontSize="sm">{item.label}</Text>
                            <Text fontSize="xs" color="fg.muted">
                              {item.description}
                            </Text>
                          </VStack>
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </HStack>
              ))}
            </VStack>

            <VStack gap={2} align="stretch">
              <HStack gap={2}>
                <Text fontWeight="600" fontSize="sm">
                  Custom attributes
                </Text>
                <Tooltip
                  content="Match span attribute keys beyond the four categories, with * wildcards: restricted attributes are hidden from outside the audience, dropped ones are stripped at ingestion."
                  contentProps={{ maxWidth: "340px" }}
                >
                  <Box color="fg.muted" display="inline-flex">
                    <HelpCircle size={13} />
                  </Box>
                </Tooltip>
                <Spacer />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setCustomAttributes((prev) => [
                      ...prev,
                      { pattern: "", disposition: "restrict" },
                    ])
                  }
                >
                  <Plus size={14} /> Add attribute rule
                </Button>
              </HStack>
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
                        width="160px"
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
            </VStack>

            {anyRestrict && (
              <VStack gap={2} align="stretch">
                <Text fontWeight="600" fontSize="sm">
                  Restricted content is visible to
                </Text>
                <AudiencePicker
                  audience={audience}
                  options={audienceOptions}
                  onChange={(next) => {
                    setAudience(next);
                    touchRestrictedCategories();
                  }}
                />
                <Text fontSize="xs" color="fg.muted">
                  {describeAudienceSelection(audience, audienceOptions)}
                </Text>
              </VStack>
            )}

            <Separator />

            <VStack gap={2} align="stretch">
              <HStack gap={3} align="start">
                <Switch
                  checked={piiLevel !== "disabled"}
                  onCheckedChange={({ checked }) => {
                    setPiiLevel(
                      checked === true
                        ? lastEnabledPiiLevel.current
                        : "disabled",
                    );
                    setTouched((prev) => ({ ...prev, pii: true }));
                  }}
                />
                <VStack align="start" gap={0}>
                  <Text fontWeight="600" fontSize="sm">
                    PII redaction
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    Masks personal data like emails, phones, cards, and IDs in
                    stored content.
                  </Text>
                </VStack>
              </HStack>
              {piiLevel !== "disabled" && (
                <>
                  <RadioGroup.Root
                    value={piiLevel}
                    paddingLeft={10}
                    onValueChange={(d) => {
                      const next = (d.value as PiiLevel) ?? "essential";
                      setPiiLevel(next);
                      // Seed custom with the native essentials the first time so
                      // it starts from a sensible base the customer can pare down.
                      if (next === "custom") {
                        setPiiEntities((prev) =>
                          prev.length > 0
                            ? prev
                            : Object.keys(ESSENTIAL_PII_ENTITY_LABELS),
                        );
                      }
                      setTouched((prev) => ({ ...prev, pii: true }));
                    }}
                  >
                    <VStack align="start" gap={1}>
                      <RadioGroup.Item value="essential">
                        <RadioGroup.ItemHiddenInput />
                        <RadioGroup.ItemIndicator />
                        <RadioGroup.ItemText>
                          Essential (emails, phones, cards, IPs, national IDs)
                        </RadioGroup.ItemText>
                        <Tooltip
                          content={`Detects and masks: ${ESSENTIAL_PII_SUMMARY}.`}
                          contentProps={{ maxWidth: "340px" }}
                        >
                          <Box color="fg.muted" display="inline-flex">
                            <HelpCircle size={13} />
                          </Box>
                        </Tooltip>
                      </RadioGroup.Item>
                      <RadioGroup.Item value="strict">
                        <RadioGroup.ItemHiddenInput />
                        <RadioGroup.ItemIndicator />
                        <RadioGroup.ItemText>
                          Strict (adds names, locations, and more)
                        </RadioGroup.ItemText>
                        <Tooltip
                          content={`Everything in Essential, plus deeper detection of: ${STRICT_ADDED_PII_SUMMARY}.`}
                          contentProps={{ maxWidth: "340px" }}
                        >
                          <Box color="fg.muted" display="inline-flex">
                            <HelpCircle size={13} />
                          </Box>
                        </Tooltip>
                      </RadioGroup.Item>
                      <RadioGroup.Item value="custom">
                        <RadioGroup.ItemHiddenInput />
                        <RadioGroup.ItemIndicator />
                        <RadioGroup.ItemText>
                          Custom (choose exactly what to redact)
                        </RadioGroup.ItemText>
                      </RadioGroup.Item>
                    </VStack>
                  </RadioGroup.Root>
                  {piiLevel === "custom" && (
                    <VStack align="stretch" gap={3} paddingLeft={10}>
                      <PiiEntityToggleGroup
                        title="Fast detection"
                        hint="Redacted instantly as data arrives, at no extra cost."
                        labels={ESSENTIAL_PII_ENTITY_LABELS}
                        selected={piiEntities}
                        onToggle={togglePiiEntity}
                      />
                      <PiiEntityToggleGroup
                        title="Deep detection"
                        hint="Also finds names and locations. May add some latency."
                        labels={STRICT_ADDED_PII_ENTITY_LABELS}
                        selected={piiEntities}
                        onToggle={togglePiiEntity}
                      />
                    </VStack>
                  )}
                </>
              )}
            </VStack>

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
                  {secretsPatterns.length > 0 && (
                    <Text fontWeight="600" fontSize="sm">
                      Custom patterns
                    </Text>
                  )}
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

interface AudienceItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const AudienceItemIcon = ({ value }: { value: string }) => {
  if (value === ALL_MEMBERS_VALUE) return <Users size={14} aria-hidden />;
  if (value === PROJECT_OWNER_VALUE) return <UserLock size={14} aria-hidden />;
  if (value === ROLE_VALUES.admins) return <Shield size={14} aria-hidden />;
  if (value === ROLE_VALUES.viewers) return <Eye size={14} aria-hidden />;
  if (value === ROLE_VALUES.members) return <User size={14} aria-hidden />;
  return <Users size={14} aria-hidden />;
};

/**
 * The restrict-audience picker: one multi-select of groups, in the same chip
 * style as the scope picker. "All members" already covers everyone with
 * access, so picking it replaces the selection and picking anything narrower
 * drops it (see applyAudienceSelection).
 */
function AudiencePicker({
  audience,
  options,
  onChange,
}: {
  audience: AudienceFormState;
  options: DataPrivacyAudienceOptions;
  onChange: (next: AudienceFormState) => void;
}) {
  const items = useMemo<AudienceItem[]>(
    () => [
      { value: ALL_MEMBERS_VALUE, label: "All members" },
      {
        value: PROJECT_OWNER_VALUE,
        label: "Project owners (their own personal projects)",
      },
      { value: ROLE_VALUES.admins, label: "Admins" },
      { value: ROLE_VALUES.members, label: "Members" },
      { value: ROLE_VALUES.viewers, label: "Viewers" },
      ...(options.groups.length > 0
        ? options.groups.map((g) => ({
            value: `group:${g.id}`,
            label: g.name,
          }))
        : [
            {
              value: "group:__none",
              label: "No custom groups in this organization yet",
              disabled: true,
            },
          ]),
    ],
    [options.groups],
  );
  const collection = useMemo(
    () =>
      createListCollection({
        items,
        isItemDisabled: (item) => item.disabled === true,
      }),
    [items],
  );
  const selected = audienceToSelection(audience);
  const labelFor = (value: string) =>
    value === PROJECT_OWNER_VALUE
      ? "Project owners"
      : (items.find((i) => i.value === value)?.label ?? value);
  const roleItems = items.filter((i) =>
    (Object.values(ROLE_VALUES) as string[]).includes(i.value),
  );
  const customItems = items.filter((i) => i.value.startsWith("group:"));
  return (
    <Select.Root
      collection={collection}
      value={selected}
      multiple
      size="sm"
      onValueChange={(d) =>
        onChange(selectionToAudience(applyAudienceSelection(selected, d.value)))
      }
    >
      <Select.Trigger
        background="bg"
        aria-label="Restricted content is visible to"
      >
        <Select.ValueText placeholder="No one (fully hidden)">
          {() =>
            selected.length > 0 ? (
              <HStack gap={1.5} flexWrap="wrap">
                {selected.map((value) => (
                  <HStack
                    key={value}
                    gap={1}
                    paddingX={1.5}
                    borderWidth="1px"
                    borderRadius="md"
                    fontSize="xs"
                  >
                    <AudienceItemIcon value={value} />
                    <Text>{labelFor(value)}</Text>
                  </HStack>
                ))}
              </HStack>
            ) : (
              "No one (fully hidden)"
            )
          }
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        <Select.ItemGroup label="Everyone">
          <Select.Item item={items[0]}>
            <HStack gap={2}>
              <AudienceItemIcon value={ALL_MEMBERS_VALUE} />
              <Text>All members</Text>
            </HStack>
          </Select.Item>
        </Select.ItemGroup>
        <Select.ItemGroup label="Project owners">
          <Select.Item item={items[1]}>
            <HStack gap={2}>
              <AudienceItemIcon value={PROJECT_OWNER_VALUE} />
              <Text>Project owners (their own personal projects)</Text>
            </HStack>
          </Select.Item>
        </Select.ItemGroup>
        <Select.ItemGroup label="Role groups">
          {roleItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              <HStack gap={2}>
                <AudienceItemIcon value={item.value} />
                <Text>{item.label}</Text>
              </HStack>
            </Select.Item>
          ))}
        </Select.ItemGroup>
        <Select.ItemGroup label="Custom groups">
          {customItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              <HStack gap={2}>
                <AudienceItemIcon value={item.value} />
                <Text>{item.label}</Text>
              </HStack>
            </Select.Item>
          ))}
        </Select.ItemGroup>
      </Select.Content>
    </Select.Root>
  );
}
