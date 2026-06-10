import {
  Badge,
  Button,
  Card,
  createListCollection,
  EmptyState,
  Field,
  Heading,
  HStack,
  RadioGroup,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Plus, Shield, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import SettingsLayout from "~/components/SettingsLayout";
import { Drawer } from "~/components/ui/drawer";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  buildRuleConfig,
  isEmptyRuleConfig,
  ruleSummary,
  type RuleAudience,
} from "~/components/settings/dataPrivacyRuleConfig";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type DataPrivacyConfig,
  type Disposition,
  type PiiLevel,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type {
  DataPrivacyRule,
  DataPrivacyScopeAvailable,
} from "~/server/data-privacy/dataPrivacyPolicy.read";
import { api } from "~/utils/api";

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

type ScopeOption = {
  key: string;
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
  scopeId: string;
  label: string;
};

function buildScopeOptions(available: DataPrivacyScopeAvailable): ScopeOption[] {
  const options: ScopeOption[] = [];
  if (available.organization) {
    options.push({
      key: `ORGANIZATION:${available.organization.id}`,
      scopeType: "ORGANIZATION",
      scopeId: available.organization.id,
      label: `${available.organization.name} (organization)`,
    });
  }
  for (const d of available.departments) {
    options.push({
      key: `DEPARTMENT:${d.id}`,
      scopeType: "DEPARTMENT",
      scopeId: d.id,
      label: `${d.name} (department)`,
    });
  }
  for (const t of available.teams) {
    options.push({
      key: `TEAM:${t.id}`,
      scopeType: "TEAM",
      scopeId: t.id,
      label: `${t.name} (team)`,
    });
  }
  for (const p of available.projects) {
    options.push({
      key: `PROJECT:${p.id}`,
      scopeType: "PROJECT",
      scopeId: p.id,
      label: `${p.name} (project)`,
    });
  }
  return options;
}

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
  const snapshotQuery = api.dataPrivacy.getSnapshot.useQuery({ projectId });
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  const available = snapshot?.available;
  const canWrite =
    !!available &&
    (!!available.organization ||
      available.departments.length > 0 ||
      available.teams.length > 0 ||
      available.projects.length > 0);

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
          {canWrite && (
            <Button colorPalette="blue" onClick={() => setDrawerOpen(true)}>
              Add privacy rule
            </Button>
          )}
        </HStack>

        <Text fontSize="sm" color="fg.muted">
          Control what trace content LangWatch stores, who can see it, and how
          secrets and PII are scrubbed, at any scope, inherited down to projects.
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
                        onClick={() => setDrawerOpen(true)}
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
                    {snapshot.rules.map((rule) => {
                      const Icon = SCOPE_ICON[rule.scopeType] ?? Folder;
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
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                loading={removeForScope.isLoading}
                                onClick={() => void removeRule(rule)}
                                aria-label="Remove privacy rule"
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </Card.Body>
            </Card.Root>
          )
        )}

        {available && (
          <AddPrivacyRuleDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            available={available}
            isSaving={setForScope.isLoading}
            onSave={async (scope, personalOnly, config) => {
              try {
                await setForScope.mutateAsync({
                  projectId,
                  scope,
                  personalOnly,
                  config,
                });
                void invalidate();
                toaster.create({ title: "Privacy rule saved", type: "success" });
                setDrawerOpen(false);
              } catch (error) {
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
              <Text>{DISPOSITION_LABELS[effective.categories[category].disposition]}</Text>
            </HStack>
          ))}
          <HStack justifyContent="space-between">
            <Text color="fg.muted">PII redaction</Text>
            <Text>{PII_LABELS[effective.pii.level]}</Text>
          </HStack>
          <HStack justifyContent="space-between">
            <Text color="fg.muted">Secrets redaction</Text>
            <Text>{effective.secrets.enabled ? "On" : "Off"}</Text>
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

const dispositionCollection = createListCollection({
  items: [
    { value: "capture", label: "Captured (visible to your team)" },
    { value: "restrict", label: "Restricted (hidden from outside the audience)" },
    { value: "drop", label: "Dropped (never stored)" },
  ],
});

const audienceCollection = createListCollection({
  items: [
    { value: "admins", label: "Admins only" },
    { value: "allMembers", label: "All members" },
    { value: "noOne", label: "No one (fully hidden)" },
  ],
});

function AddPrivacyRuleDrawer({
  open,
  onClose,
  available,
  isSaving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  available: DataPrivacyScopeAvailable;
  isSaving: boolean;
  onSave: (
    scope: { scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT"; scopeId: string },
    personalOnly: boolean,
    config: DataPrivacyConfig,
  ) => void;
}) {
  const scopeOptions = useMemo(() => buildScopeOptions(available), [available]);
  const scopeCollection = useMemo(
    () =>
      createListCollection({
        items: scopeOptions.map((o) => ({ value: o.key, label: o.label })),
      }),
    [scopeOptions],
  );

  const [scopeKey, setScopeKey] = useState<string>("");
  const [personalOnly, setPersonalOnly] = useState(false);
  const [dispositions, setDispositions] = useState<Record<ContentCategory, Disposition>>({
    input: "capture",
    output: "capture",
    system: "capture",
    tools: "capture",
  });
  const [audience, setAudience] = useState<RuleAudience>("admins");
  const [piiLevel, setPiiLevel] = useState<PiiLevel>("essential");
  const [secretsEnabled, setSecretsEnabled] = useState(true);

  useEffect(() => {
    if (open) {
      setScopeKey(scopeOptions[0]?.key ?? "");
      setPersonalOnly(false);
      setDispositions({ input: "capture", output: "capture", system: "capture", tools: "capture" });
      setAudience("admins");
      setPiiLevel("essential");
      setSecretsEnabled(true);
    }
  }, [open, scopeOptions]);

  const scope = scopeOptions.find((o) => o.key === scopeKey);
  const anyRestrict = CONTENT_CATEGORIES.some((c) => dispositions[c] === "restrict");
  const canTogglePersonal = scope?.scopeType === "ORGANIZATION" || scope?.scopeType === "DEPARTMENT";

  const config = useMemo<DataPrivacyConfig>(
    () => buildRuleConfig({ dispositions, audience, piiLevel, secretsEnabled }),
    [dispositions, audience, piiLevel, secretsEnabled],
  );
  const isEmpty = isEmptyRuleConfig(config);
  const canSave = !!scope && !isEmpty && !isSaving;

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
          <Heading size="md">Add privacy rule</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            <Field.Root>
              <Field.Label>Scope</Field.Label>
              <Select.Root
                collection={scopeCollection}
                value={scopeKey ? [scopeKey] : []}
                onValueChange={(d) => setScopeKey(d.value[0] ?? "")}
              >
                <Select.Trigger background="bg">
                  <Select.ValueText placeholder="Pick a scope" />
                </Select.Trigger>
                <Select.Content>
                  {scopeCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {canTogglePersonal && (
                <HStack gap={3} marginTop={2}>
                  <Switch
                    checked={personalOnly}
                    onCheckedChange={({ checked }) => setPersonalOnly(checked === true)}
                  />
                  <Text fontSize="sm">Personal projects only</Text>
                </HStack>
              )}
            </Field.Root>

            <VStack gap={3} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Content
              </Text>
              {CONTENT_CATEGORIES.map((category) => (
                <Field.Root key={category}>
                  <Field.Label>{CATEGORY_LABELS[category]}</Field.Label>
                  <Select.Root
                    collection={dispositionCollection}
                    value={[dispositions[category]]}
                    onValueChange={(d) =>
                      setDispositions((prev) => ({
                        ...prev,
                        [category]: (d.value[0] as Disposition) ?? "capture",
                      }))
                    }
                  >
                    <Select.Trigger background="bg">
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
                </Field.Root>
              ))}
              {anyRestrict && (
                <Field.Root>
                  <Field.Label>Restricted content is visible to</Field.Label>
                  <Select.Root
                    collection={audienceCollection}
                    value={[audience]}
                    onValueChange={(d) => setAudience((d.value[0] as RuleAudience) ?? "admins")}
                  >
                    <Select.Trigger background="bg">
                      <Select.ValueText />
                    </Select.Trigger>
                    <Select.Content>
                      {audienceCollection.items.map((item) => (
                        <Select.Item key={item.value} item={item}>
                          {item.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Field.Root>
              )}
            </VStack>

            <Field.Root>
              <Field.Label>PII redaction</Field.Label>
              <RadioGroup.Root
                value={piiLevel}
                onValueChange={(d) => setPiiLevel((d.value as PiiLevel) ?? "essential")}
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
                      Strict (adds names and locations, uses the analysis service)
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                </VStack>
              </RadioGroup.Root>
            </Field.Root>

            <HStack gap={3} align="start">
              <Switch
                checked={secretsEnabled}
                onCheckedChange={({ checked }) => setSecretsEnabled(checked === true)}
              />
              <VStack align="start" gap={0}>
                <Text fontWeight="600" fontSize="sm">
                  Secrets redaction
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Scrubs API keys, tokens, private keys, and database URLs. On by
                  default.
                </Text>
              </VStack>
            </HStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end" gap={2}>
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => {
                if (!scope) return;
                onSave(
                  { scopeType: scope.scopeType, scopeId: scope.scopeId },
                  canTogglePersonal ? personalOnly : false,
                  config,
                );
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
