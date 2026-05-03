// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
import { EnterpriseLockedSurface } from "~/components/enterprise/EnterpriseLockedSurface";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Anomaly rule authoring surface, wired to api.anomalyRules.* (Sergey
 * slice B2 — real PG persistence). Rules persist immediately; the
 * evaluation engine + alert dispatch (Option C) lands as a follow-up
 * — copy is honest about that.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */

type Rule = RouterOutputs["anomalyRules"]["list"][number];
type Severity = "critical" | "warning" | "info";
type Scope =
  | "organization"
  | "team"
  | "project"
  | "source_type"
  | "source";

const SEVERITY_OPTIONS: Array<{ value: Severity; label: string; tone: string }> = [
  { value: "critical", label: "Critical", tone: "red" },
  { value: "warning", label: "Warning", tone: "orange" },
  { value: "info", label: "Info", tone: "blue" },
];

// Reactor evaluates organization / source_type / source today; team and
// project are persisted but skipped at evaluation time, so they're held
// back from the composer until the reactor adds them. See
// docs/ai-gateway/governance/anomaly-rules.mdx scope coverage table.
const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
  { value: "organization", label: "Organization" },
  { value: "source_type", label: "Ingestion source type" },
  { value: "source", label: "Specific ingestion source" },
];

// Only spend_spike is wired to the anomaly reactor today; the other rule
// types accept persistence but the reactor logs debug + skips them. The
// composer offers only the live type — admins typing a custom value can
// still override (the field stays freeform), but autocomplete won't
// promise something the runtime doesn't deliver. Doc page lists the full
// preview roadmap.
const RULE_TYPE_SUGGESTIONS = ["spend_spike"];

const SPEND_SPIKE_THRESHOLD_TEMPLATE = JSON.stringify(
  {
    windowSec: 86400,
    ratioVsBaseline: 2.0,
    minBaselineUsd: 1.0,
    baselineOffsetSec: 604800,
  },
  null,
  2,
);

interface ComposerState {
  id?: string;
  name: string;
  description: string;
  severity: Severity;
  ruleType: string;
  scope: Scope;
  scopeId: string;
  thresholdConfig: string;
  destinationConfig: string;
}

const blankComposer = (): ComposerState => ({
  name: "",
  description: "",
  severity: "warning",
  ruleType: "spend_spike",
  scope: "organization",
  scopeId: "",
  thresholdConfig: SPEND_SPIKE_THRESHOLD_TEMPLATE,
  destinationConfig: "{}",
});

function AnomalyRulesPage() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
      organizationId: orgId,
      enabled: !!orgId,
    });

  const rulesQuery = api.anomalyRules.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const refetch = () =>
    utils.anomalyRules.list.invalidate({ organizationId: orgId });

  const [composer, setComposer] = useState<ComposerState | null>(null);

  const createMutation = api.anomalyRules.create.useMutation({
    onSuccess: () => {
      void refetch();
      setComposer(null);
      toaster.create({ title: "Rule created", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to create rule",
        description: e.message,
        type: "error",
      }),
  });
  const updateMutation = api.anomalyRules.update.useMutation({
    onSuccess: () => {
      void refetch();
      setComposer(null);
      toaster.create({ title: "Rule updated", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to update rule",
        description: e.message,
        type: "error",
      }),
  });
  const archiveMutation = api.anomalyRules.archive.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Rule archived", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to archive",
        description: e.message,
        type: "error",
      }),
  });

  const grouped = useMemo(() => {
    const out: Record<Severity, Rule[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    for (const r of rulesQuery.data ?? []) {
      out[r.severity as Severity]?.push(r);
    }
    return out;
  }, [rulesQuery.data]);

  const startEdit = (rule: Rule) =>
    setComposer({
      id: rule.id,
      name: rule.name,
      description: rule.description ?? "",
      severity: rule.severity as Severity,
      ruleType: rule.ruleType,
      scope: rule.scope as Scope,
      scopeId: rule.scopeId,
      thresholdConfig: JSON.stringify(
        rule.thresholdConfig ?? {},
        null,
        2,
      ),
      destinationConfig: JSON.stringify(
        rule.destinationConfig ?? {},
        null,
        2,
      ),
    });

  const onSubmit = () => {
    if (!composer) return;
    if (!composer.name.trim()) return;
    if (!composer.scopeId.trim() && composer.scope !== "organization") return;
    let thresholdConfig: Record<string, unknown>;
    let destinationConfig: Record<string, unknown>;
    try {
      thresholdConfig = JSON.parse(composer.thresholdConfig || "{}");
      destinationConfig = JSON.parse(composer.destinationConfig || "{}");
    } catch (e) {
      toaster.create({
        title: "Invalid JSON in config field",
        description: (e as Error).message,
        type: "error",
      });
      return;
    }
    const scopeId =
      composer.scope === "organization"
        ? orgId
        : composer.scopeId.trim();

    if (composer.id) {
      updateMutation.mutate({
        id: composer.id,
        organizationId: orgId,
        name: composer.name.trim(),
        description: composer.description.trim() || null,
        severity: composer.severity,
        ruleType: composer.ruleType,
        scope: composer.scope,
        scopeId,
        thresholdConfig,
        destinationConfig,
      });
    } else {
      createMutation.mutate({
        organizationId: orgId,
        name: composer.name.trim(),
        description: composer.description.trim() || null,
        severity: composer.severity,
        ruleType: composer.ruleType,
        scope: composer.scope,
        scopeId,
        thresholdConfig,
        destinationConfig,
      });
    }
  };

  if (ffLoading) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <SettingsLayout>
      <EnterpriseLockedSurface
        featureName="Anomaly Rules"
        description="Anomaly Rules let your governance team define thresholds that page on-call when ingestion drifts. Available on Enterprise plans."
      >
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Anomaly Rules</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm" maxW="3xl">
              Define thresholds that page on-call when activity drifts.
              Rules surface on the{" "}
              <Link href="/governance" color="orange.600">
                governance overview
              </Link>{" "}
              once they fire.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {composer && (
          <RuleComposer
            composer={composer}
            setComposer={setComposer}
            onSubmit={onSubmit}
            onCancel={() => setComposer(null)}
            isPending={isPending}
            orgId={orgId}
          />
        )}

        {rulesQuery.isLoading && <Spinner size="sm" />}

        {(["critical", "warning", "info"] as const).map((sev) => {
          const meta = SEVERITY_OPTIONS.find((o) => o.value === sev)!;
          return (
            <Box
              key={sev}
              as="section"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={4}
            >
              <HStack alignItems="start" marginBottom={3}>
                <VStack align="start" gap={0}>
                  <HStack gap={2}>
                    <Text fontSize="sm" fontWeight="semibold">
                      {meta.label}
                    </Text>
                    <Badge size="sm" variant="surface">
                      {grouped[sev].length}
                    </Badge>
                  </HStack>
                </VStack>
                <Spacer />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fresh = blankComposer();
                    fresh.severity = sev;
                    setComposer(fresh);
                  }}
                  disabled={!!composer}
                >
                  <Plus size={14} /> New rule
                </Button>
              </HStack>

              <VStack align="stretch" gap={2}>
                {grouped[sev].length === 0 && (
                  <Text fontSize="sm" color="fg.muted">
                    No {meta.label.toLowerCase()} rules.
                  </Text>
                )}
                {grouped[sev].map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    onEdit={() => startEdit(rule)}
                    onArchive={() =>
                      archiveMutation.mutate({
                        id: rule.id,
                        organizationId: orgId,
                      })
                    }
                    isArchiving={
                      archiveMutation.isPending &&
                      archiveMutation.variables?.id === rule.id
                    }
                  />
                ))}
              </VStack>
            </Box>
          );
        })}
      </VStack>
      </EnterpriseLockedSurface>
    </SettingsLayout>
  );
}

function RuleRow({
  rule,
  onEdit,
  onArchive,
  isArchiving,
}: {
  rule: Rule;
  onEdit: () => void;
  onArchive: () => void;
  isArchiving: boolean;
}) {
  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={3}
      gap={3}
      opacity={rule.status === "disabled" ? 0.55 : 1}
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2} wrap="wrap">
          <Text fontSize="sm" fontWeight="medium">
            {rule.name}
          </Text>
          <Badge size="sm" variant="surface">
            {rule.ruleType}
          </Badge>
          {rule.status === "disabled" && (
            <Badge size="sm" variant="surface" colorPalette="gray">
              Disabled
            </Badge>
          )}
        </HStack>
        {rule.description && (
          <Text fontSize="xs" color="fg.muted">
            {rule.description}
          </Text>
        )}
        <Text fontSize="xs" color="fg.muted">
          scope: {rule.scope}
          {rule.scope !== "organization" && rule.scopeId
            ? ` · ${rule.scopeId}`
            : ""}
        </Text>
      </VStack>
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil size={14} /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="red"
        onClick={onArchive}
        loading={isArchiving}
        title="Archive rule"
      >
        <Trash2 size={14} />
      </Button>
    </HStack>
  );
}

const SOURCE_TYPE_PICKER_OPTIONS = [
  { value: "otel_generic", label: "Generic OTel (otel_generic)" },
  { value: "claude_cowork", label: "Claude Cowork (claude_cowork)" },
  { value: "workato", label: "Workato (workato)" },
  { value: "copilot_studio", label: "Copilot Studio (copilot_studio)" },
  { value: "openai_compliance", label: "OpenAI Compliance (openai_compliance)" },
  { value: "claude_compliance", label: "Claude Compliance (claude_compliance)" },
  { value: "s3_custom", label: "S3 Custom (s3_custom)" },
];

function RuleComposer({
  composer,
  setComposer,
  onSubmit,
  onCancel,
  isPending,
  orgId,
}: {
  composer: ComposerState;
  setComposer: (next: ComposerState | null) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  orgId: string;
}) {
  const [scopeIdMode, setScopeIdMode] = useState<"picker" | "custom">(
    "picker",
  );
  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    {
      enabled: composer.scope === "source" && !!orgId,
      refetchOnWindowFocus: false,
    },
  );
  const isEdit = !!composer.id;
  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading as="h2" size="md">
            {isEdit ? "Edit anomaly rule" : "New anomaly rule"}
          </Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={3}>
        <HStack gap={3}>
          <VStack align="stretch" gap={1} flex={2}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Name
            </Text>
            <Input
              size="sm"
              backgroundColor="white"
              value={composer.name}
              onChange={(e) =>
                setComposer({ ...composer, name: e.target.value })
              }
              placeholder="Display name for this rule"
            />
          </VStack>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Severity
            </Text>
            <select
              value={composer.severity}
              onChange={(e) =>
                setComposer({
                  ...composer,
                  severity: e.target.value as Severity,
                })
              }
              style={selectStyle}
            >
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </VStack>
        </HStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Description (optional)
          </Text>
          <Textarea
            size="sm"
            backgroundColor="white"
            rows={2}
            value={composer.description}
            onChange={(e) =>
              setComposer({ ...composer, description: e.target.value })
            }
            placeholder="What this rule guards against and who owns it"
          />
        </VStack>

        <HStack gap={3}>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Rule type
            </Text>
            <Input
              size="sm"
              backgroundColor="white"
              list="rule-type-suggestions"
              value={composer.ruleType}
              onChange={(e) => {
                const nextRuleType = e.target.value;
                setComposer({
                  ...composer,
                  ruleType: nextRuleType,
                  // Auto-fill the threshold template when the user picks
                  // spend_spike from a blank composer — saves them
                  // grepping the reactor for the schema. If they've
                  // already customised the JSON, leave it alone.
                  thresholdConfig:
                    nextRuleType === "spend_spike" &&
                    (composer.thresholdConfig.trim() === "" ||
                      composer.thresholdConfig.trim() === "{}")
                      ? SPEND_SPIKE_THRESHOLD_TEMPLATE
                      : composer.thresholdConfig,
                });
              }}
              placeholder="spend_spike"
            />
            <datalist id="rule-type-suggestions">
              {RULE_TYPE_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Text fontSize="xs" color="fg.muted">
              Only <code>spend_spike</code> is evaluated by the anomaly
              reactor today. Other rule types (<code>rate_limit</code>,
              <code>after_hours</code>, …) are{" "}
              <Link
                href="/ai-gateway/governance/anomaly-rules"
                color="orange.600"
              >
                preview
              </Link>{" "}
              — persisted as active but not yet detected.
            </Text>
          </VStack>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Scope
            </Text>
            <select
              value={composer.scope}
              onChange={(e) =>
                setComposer({ ...composer, scope: e.target.value as Scope })
              }
              style={selectStyle}
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </VStack>
          {composer.scope !== "organization" && (
            <VStack align="stretch" gap={1} flex={1}>
              <HStack gap={2} alignItems="center">
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  {composer.scope === "source"
                    ? "Ingestion source"
                    : composer.scope === "source_type"
                      ? "Source type"
                      : "Scope ID"}
                </Text>
                <Spacer />
                <Button
                  size="xs"
                  variant="ghost"
                  fontSize="xs"
                  color="orange.600"
                  onClick={() =>
                    setScopeIdMode((m) =>
                      m === "picker" ? "custom" : "picker",
                    )
                  }
                >
                  {scopeIdMode === "picker" ? "type a custom ID" : "use picker"}
                </Button>
              </HStack>
              {scopeIdMode === "picker" && composer.scope === "source" ? (
                <select
                  value={composer.scopeId}
                  onChange={(e) =>
                    setComposer({ ...composer, scopeId: e.target.value })
                  }
                  style={selectStyle}
                  disabled={sourcesQuery.isLoading}
                >
                  <option value="">
                    {sourcesQuery.isLoading
                      ? "Loading sources…"
                      : "— select an ingestion source —"}
                  </option>
                  {(sourcesQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sourceType})
                    </option>
                  ))}
                </select>
              ) : scopeIdMode === "picker" && composer.scope === "source_type" ? (
                <select
                  value={composer.scopeId}
                  onChange={(e) =>
                    setComposer({ ...composer, scopeId: e.target.value })
                  }
                  style={selectStyle}
                >
                  <option value="">— select a source type —</option>
                  {SOURCE_TYPE_PICKER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  size="sm"
                  backgroundColor="white"
                  value={composer.scopeId}
                  onChange={(e) =>
                    setComposer({ ...composer, scopeId: e.target.value })
                  }
                  placeholder={
                    composer.scope === "source_type"
                      ? "otel_generic, workato, ..."
                      : composer.scope === "source"
                        ? "ingestion source ID"
                        : `${composer.scope} ID`
                  }
                />
              )}
            </VStack>
          )}
        </HStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Threshold config (rule-type-specific JSON)
          </Text>
          <Textarea
            size="sm"
            backgroundColor="white"
            rows={4}
            fontFamily="mono"
            value={composer.thresholdConfig}
            onChange={(e) =>
              setComposer({ ...composer, thresholdConfig: e.target.value })
            }
            placeholder="{}"
          />
        </VStack>

        <Box
          borderWidth="1px"
          borderColor="purple.300"
          backgroundColor="purple.50"
          padding={3}
          borderRadius="sm"
        >
          <Text fontSize="xs" color="purple.900">
            <strong>Alert destinations:</strong> alerts surface on the{" "}
            <Link href="/governance" color="orange.600">
              governance dashboard
            </Link>{" "}
            today. Slack, PagerDuty, webhook, and email destinations ship
            in a follow-up release — the composer will gain structured
            destination fields then. (See{" "}
            <Link
              href="/ai-gateway/governance/anomaly-rules"
              color="orange.600"
            >
              anomaly rules docs
            </Link>{" "}
            for the dispatch coverage table.)
          </Text>
        </Box>

          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack gap={3} width="full">
            <Spacer />
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={onSubmit}
              loading={isPending}
              disabled={
                !composer.name.trim() ||
                (composer.scope !== "organization" && !composer.scopeId.trim())
              }
            >
              {isEdit ? "Save changes" : "Create rule"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

const selectStyle = {
  padding: "8px",
  border: "1px solid var(--chakra-colors-border-muted)",
  borderRadius: "var(--chakra-radii-sm)",
  background: "white",
  fontSize: "14px",
};

export default withPermissionGuard("organization:manage", { bypassOnboardingRedirect: true })(
  AnomalyRulesPage,
);
