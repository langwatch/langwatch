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
import { Info, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EnterpriseLockedSurface } from "~/components/enterprise/EnterpriseLockedSurface";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { docsUrl } from "~/utils/docsUrl";

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
type Scope = "organization" | "team" | "project" | "source_type" | "source";

const SEVERITY_OPTIONS: Array<{
  value: Severity;
  label: string;
  tone: string;
}> = [
  { value: "critical", label: "Critical", tone: "red" },
  { value: "warning", label: "Warning", tone: "orange" },
  { value: "info", label: "Info", tone: "blue" },
];

// Subscriber evaluates organization / source_type / source today; team and
// project are persisted but skipped at evaluation time, so they're held
// back from the composer until the subscriber adds them. See
// docs/ai-gateway/governance/anomaly-rules.mdx scope coverage table.
const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
  { value: "organization", label: "Organization" },
  { value: "source_type", label: "Ingestion source type" },
  { value: "source", label: "Specific ingestion source" },
];

// Only spend_spike is wired to the anomaly subscriber today; the other rule
// types accept persistence but the subscriber logs debug + skips them. The
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

/**
 * Plain-English summary of a threshold config — rendered live below
 * the JSON Textarea so admins see what their rule will actually
 * evaluate before they save (rchaves QA: "a preview would be great").
 *
 * Returns:
 *   - { kind: "ok", english } when the JSON parses + the rule type is
 *     known + every required field is present + has the right shape
 *   - { kind: "error", message } when JSON is invalid or required
 *     fields are missing/wrong type
 *   - { kind: "unsupported", english } when the rule type is in the
 *     UI suggestions but not yet wired to a detector — admin gets a
 *     clear "this won't fire" signal at compose time
 */
function summariseThresholdConfig(
  ruleType: string,
  raw: string,
):
  | { kind: "ok" | "unsupported"; english: string }
  | { kind: "error"; message: string } {
  // Order matters: non-spend_spike rule types are persisted as
  // preview-mode (Sergey 5f416d410 — server accepts any
  // thresholdConfig shape for non-detector-wired types). So check
  // ruleType FIRST. Empty `{}` on rate_limit / after_hours /
  // model_drift / error_rate is a valid save — surface it as
  // "Won't fire" rather than the spend_spike-shape "Empty config"
  // error.
  if (ruleType !== "spend_spike") {
    if (raw.trim() !== "" && raw.trim() !== "{}") {
      try {
        JSON.parse(raw);
      } catch (err) {
        return {
          kind: "error",
          message: `Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
        };
      }
    }
    return {
      kind: "unsupported",
      english: `\`${ruleType}\` is in preview — the rule will save but no detector runs against it yet. \`spend_spike\` is the only type evaluated today; the others (\`rate_limit\`, \`after_hours\`, \`model_drift\`, \`error_rate\`) ship as detectors land.`,
    };
  }
  if (raw.trim() === "" || raw.trim() === "{}") {
    return {
      kind: "error",
      message:
        "Empty config — fill in the rule-type-specific fields below or click the rule type to load the template.",
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "error",
      message: `Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
    };
  }
  const windowSec = parsed.windowSec;
  const ratio = parsed.ratioVsBaseline;
  const minBaseline = parsed.minBaselineUsd;
  const baselineOffset = parsed.baselineOffsetSec;
  if (
    typeof windowSec !== "number" ||
    typeof ratio !== "number" ||
    typeof minBaseline !== "number" ||
    typeof baselineOffset !== "number"
  ) {
    return {
      kind: "error",
      message:
        "spend_spike requires numeric `windowSec`, `ratioVsBaseline`, `minBaselineUsd`, and `baselineOffsetSec`.",
    };
  }
  const fmtDuration = (sec: number): string => {
    if (sec >= 86400)
      return `${Math.round((sec / 86400) * 10) / 10} day${sec === 86400 ? "" : "s"}`;
    if (sec >= 3600)
      return `${Math.round((sec / 3600) * 10) / 10} hour${sec === 3600 ? "" : "s"}`;
    if (sec >= 60)
      return `${Math.round((sec / 60) * 10) / 10} minute${sec === 60 ? "" : "s"}`;
    return `${sec} second${sec === 1 ? "" : "s"}`;
  };
  return {
    kind: "ok",
    english: `Fires when spend in the last ${fmtDuration(windowSec)} is at least ${ratio}× the spend in the equivalent ${fmtDuration(windowSec)} window from ${fmtDuration(baselineOffset)} ago, AND that baseline is at least $${minBaseline}. Otherwise the baseline is too noisy and the rule stays quiet.`,
  };
}

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

function AnomalyRulesHeader() {
  return (
    <HStack alignItems="end">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Heading size="md">Anomaly Rules</Heading>
          <Badge colorPalette="purple" size="sm" variant="surface">
            Preview
          </Badge>
        </HStack>
        <Text color="fg.muted" fontSize="sm" maxW="3xl">
          Define thresholds that page on-call when activity drifts. Rules
          surface on the{" "}
          <Link href="/governance" color="blue.fgMuted">
            governance overview
          </Link>{" "}
          once they fire.
        </Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

/**
 * The id the archive mutation is currently working on, so one row can show its
 * own spinner without every row spinning. Null while idle.
 */
function pendingRuleId(mutation: {
  isPending: boolean;
  variables?: { id: string } | undefined;
}): string | null {
  return mutation.isPending ? (mutation.variables?.id ?? null) : null;
}

/**
 * The severity sections count off the loaded list, so a failed load would
 * render "Critical 0 / Warning 0 / Info 0". On an alerting surface that reads
 * as "you have no critical rules", a claim we cannot make when we never got
 * the list. This says what went wrong and offers the retry instead. The
 * sections and their "New rule" buttons stay, because a failed read is no
 * reason to take away the ability to write.
 */
function RuleListLoadError({
  error,
  isRefetching,
  onRetry,
}: {
  error: unknown;
  isRefetching: boolean;
  onRetry: () => void;
}) {
  return (
    <VStack align="start" gap={2}>
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load anomaly rules"
      />
      <Button
        size="xs"
        variant="outline"
        onClick={onRetry}
        loading={isRefetching}
      >
        <RotateCw size={12} /> Try again
      </Button>
    </VStack>
  );
}

/** One severity bucket: its count, its "New rule" control, and its rows. */
function RuleSeveritySection({
  severity,
  rules,
  knowsFleetIsEmpty,
  canManage,
  composerOpen,
  archivingId,
  onNewRule,
  onEdit,
  onArchive,
}: {
  severity: Severity;
  rules: Rule[];
  knowsFleetIsEmpty: boolean;
  canManage: boolean;
  composerOpen: boolean;
  archivingId: string | null;
  onNewRule: () => void;
  onEdit: (rule: Rule) => void;
  onArchive: (rule: Rule) => void;
}) {
  const meta = SEVERITY_OPTIONS.find((o) => o.value === severity)!;
  return (
    <Box
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
            {/* A count is a claim about the fleet. We only have one when
                the list actually arrived. */}
            {knowsFleetIsEmpty && (
              <Badge size="sm" variant="surface">
                {rules.length}
              </Badge>
            )}
          </HStack>
        </VStack>
        <Spacer />
        {/* The write is `anomalyRules:manage`. A viewer who only reads is
            not offered a composer the server refuses. */}
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={onNewRule}
            disabled={composerOpen}
          >
            <Plus size={14} /> New rule
          </Button>
        )}
      </HStack>

      <VStack align="stretch" gap={2}>
        {/* Same rule as the sibling sources page: "None" is a claim we can
            only make when we know. */}
        {rules.length === 0 && knowsFleetIsEmpty && (
          <Text fontSize="sm" color="fg.muted">
            No {meta.label.toLowerCase()} rules.
          </Text>
        )}
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onEdit={() => onEdit(rule)}
            onArchive={() => onArchive(rule)}
            isArchiving={archivingId === rule.id}
            canManage={canManage}
          />
        ))}
      </VStack>
    </Box>
  );
}

/** The composer state that edits an existing rule. */
function composerFromRule(rule: Rule): ComposerState {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    severity: rule.severity as Severity,
    ruleType: rule.ruleType,
    scope: rule.scope as Scope,
    scopeId: rule.scopeId,
    thresholdConfig: JSON.stringify(rule.thresholdConfig ?? {}, null, 2),
    destinationConfig: JSON.stringify(rule.destinationConfig ?? {}, null, 2),
  };
}

/**
 * The fields both the create and the update call carry, or `null` when the
 * composer cannot be submitted: no name, no scope id on a scoped rule, or
 * config text the browser cannot parse (which this has already toasted about).
 */
function buildRulePayload({
  composer,
  orgId,
}: {
  composer: ComposerState;
  orgId: string;
}) {
  if (!composer.name.trim()) return null;
  if (!composer.scopeId.trim() && composer.scope !== "organization")
    return null;
  let thresholdConfig: Record<string, unknown>;
  let destinationConfig: Record<string, unknown>;
  try {
    thresholdConfig = JSON.parse(composer.thresholdConfig || "{}");
    destinationConfig = JSON.parse(composer.destinationConfig || "{}");
  } catch (parseFailure) {
    // Local `JSON.parse` failure on text the user typed. The syntax detail
    // ("Unexpected token } in JSON at position 42") is the whole point, and
    // nothing here crossed the wire, so it is safe to show verbatim.
    toaster.create({
      title: "Invalid JSON in config field",
      description: // no-raw-error-toast-ok
        parseFailure instanceof SyntaxError ? parseFailure.message : "",
      type: "error",
    });
    return null;
  }
  return {
    organizationId: orgId,
    name: composer.name.trim(),
    description: composer.description.trim() || null,
    severity: composer.severity,
    ruleType: composer.ruleType,
    scope: composer.scope,
    scopeId:
      composer.scope === "organization" ? orgId : composer.scopeId.trim(),
    thresholdConfig,
    destinationConfig,
  };
}

/** The three mutations the page drives, with their toasts and cache busting. */
function useAnomalyRuleMutations({
  refetch,
  setComposer,
}: {
  refetch: () => unknown;
  setComposer: (next: ComposerState | null) => void;
}) {
  const create = api.anomalyRules.create.useMutation({
    onSuccess: () => {
      void refetch();
      setComposer(null);
      toaster.create({ title: "Rule created", type: "success" });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't create the rule" }),
  });
  const update = api.anomalyRules.update.useMutation({
    onSuccess: () => {
      void refetch();
      setComposer(null);
      toaster.create({ title: "Rule updated", type: "success" });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't update the rule" }),
  });
  const archive = api.anomalyRules.archive.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Rule archived", type: "success" });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't archive the rule" }),
  });
  return { create, update, archive };
}

/** Rules split into the three severity buckets the page renders. */
function useGroupedRules(rules: Rule[] | undefined) {
  return useMemo(() => {
    const out: Record<Severity, Rule[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    for (const r of rules ?? []) {
      out[r.severity as Severity]?.push(r);
    }
    return out;
  }, [rules]);
}

/**
 * Everything the page needs: the org it is scoped to, what the viewer may do,
 * the rule list, the composer state and the mutations that drive them. State
 * and callbacks only, the component owns the markup.
 */
function useAnomalyRulesPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const canRead = hasAnyPermission("anomalyRules:view");
  const canManage = hasAnyPermission("anomalyRules:manage");

  const rulesQuery = api.anomalyRules.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && canRead, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const refetch = () =>
    utils.anomalyRules.list.invalidate({ organizationId: orgId });

  const [composer, setComposer] = useState<ComposerState | null>(null);

  const {
    create: createMutation,
    update: updateMutation,
    archive: archiveMutation,
  } = useAnomalyRuleMutations({ refetch, setComposer });

  const onSubmit = () => {
    if (!composer) return;
    const payload = buildRulePayload({ composer, orgId });
    if (!payload) return;
    if (composer.id) {
      updateMutation.mutate({ id: composer.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return {
    orgId,
    canRead,
    canManage,
    rulesQuery,
    grouped: useGroupedRules(rulesQuery.data),
    composer,
    setComposer,
    archivingId: pendingRuleId(archiveMutation),
    archiveRule: (rule: Rule) =>
      archiveMutation.mutate({ id: rule.id, organizationId: orgId }),
    startEdit: (rule: Rule) => setComposer(composerFromRule(rule)),
    startCreate: (severity: Severity) => {
      const fresh = blankComposer();
      fresh.severity = severity;
      setComposer(fresh);
    },
    onSubmit,
    isPending: createMutation.isPending || updateMutation.isPending,
  };
}

function AnomalyRulesPage() {
  const {
    orgId,
    canRead,
    canManage,
    rulesQuery,
    grouped,
    composer,
    setComposer,
    archivingId,
    archiveRule,
    startEdit,
    startCreate,
    onSubmit,
    isPending,
  } = useAnomalyRulesPage();

  return (
    <GovernanceLayout pageTitle="Anomaly Rules · Governance · LangWatch">
      <EnterpriseLockedSurface
        featureName="Anomaly Rules"
        description="Anomaly Rules let your governance team define thresholds that page on-call when ingestion drifts. Available on Enterprise plans."
      >
        <VStack align="stretch" gap={6} width="full" maxW="container.xl">
          <AnomalyRulesHeader />

          {!canRead && (
            <PermissionRequiredNotice
              permission="anomalyRules:view"
              detail="The rule list stays hidden until then."
            />
          )}

          {canManage && composer && (
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

          {rulesQuery.error && (
            <RuleListLoadError
              error={rulesQuery.error}
              isRefetching={rulesQuery.isFetching}
              onRetry={() => void rulesQuery.refetch()}
            />
          )}

          {canRead &&
            (["critical", "warning", "info"] as const).map((sev) => (
              <RuleSeveritySection
                key={sev}
                severity={sev}
                rules={grouped[sev]}
                knowsFleetIsEmpty={!rulesQuery.error}
                canManage={canManage}
                composerOpen={!!composer}
                archivingId={archivingId}
                onNewRule={() => startCreate(sev)}
                onEdit={startEdit}
                onArchive={archiveRule}
              />
            ))}

          {canRead && !canManage && (
            <PermissionRequiredNotice
              permission="anomalyRules:manage"
              detail="You can read the rules. Creating, editing, and archiving need this grant."
            />
          )}
        </VStack>
      </EnterpriseLockedSurface>
    </GovernanceLayout>
  );
}

function RuleRow({
  rule,
  onEdit,
  onArchive,
  isArchiving,
  canManage,
}: {
  rule: Rule;
  onEdit: () => void;
  onArchive: () => void;
  isArchiving: boolean;
  canManage: boolean;
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
      {canManage && (
        <>
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
        </>
      )}
    </HStack>
  );
}

const SOURCE_TYPE_PICKER_OPTIONS = [
  { value: "otel_generic", label: "Generic OTel (otel_generic)" },
  { value: "claude_cowork", label: "Claude Cowork (claude_cowork)" },
  { value: "workato", label: "Workato (workato)" },
  { value: "copilot_studio", label: "Copilot Studio (copilot_studio)" },
  {
    value: "openai_compliance",
    label: "OpenAI Compliance (openai_compliance)",
  },
  {
    value: "claude_compliance",
    label: "Claude Compliance (claude_compliance)",
  },
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
  const [scopeIdMode, setScopeIdMode] = useState<"picker" | "custom">("picker");
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
                      // grepping the subscriber for the schema. If they've
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
                  subscriber today. Other rule types (<code>rate_limit</code>,
                  <code>after_hours</code>, …) are{" "}
                  <Link
                    href="/ai-gateway/governance/anomaly-rules"
                    color="blue.fgMuted"
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
                      color="blue.fgMuted"
                      onClick={() =>
                        setScopeIdMode((m) =>
                          m === "picker" ? "custom" : "picker",
                        )
                      }
                    >
                      {scopeIdMode === "picker"
                        ? "type a custom ID"
                        : "use picker"}
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
                  ) : scopeIdMode === "picker" &&
                    composer.scope === "source_type" ? (
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
              <HStack gap={2} alignItems="center">
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Threshold config (rule-type-specific JSON)
                </Text>
                <Spacer />
                <Link
                  href={docsUrl(
                    "/ai-governance/anomaly-rules#threshold-config",
                  )}
                  isExternal
                  color="blue.fgMuted"
                  fontSize="xs"
                  fontWeight="medium"
                >
                  <HStack gap={1} alignItems="center">
                    <Info size={12} />
                    <Text as="span">Schema reference</Text>
                  </HStack>
                </Link>
              </HStack>
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
              <ThresholdPreview
                ruleType={composer.ruleType}
                raw={composer.thresholdConfig}
              />
            </VStack>

            <Box
              borderWidth="1px"
              borderColor="purple.emphasized"
              backgroundColor="purple.subtle"
              padding={3}
              borderRadius="sm"
            >
              <Text fontSize="xs" color="purple.fg">
                <strong>Alert destinations:</strong> alerts surface on the{" "}
                <Link href="/governance" color="blue.fgMuted">
                  governance dashboard
                </Link>{" "}
                today. Slack, PagerDuty, webhook, and email destinations ship in
                a follow-up release — the composer will gain structured
                destination fields then. (See{" "}
                <Link
                  href="/ai-gateway/governance/anomaly-rules"
                  color="blue.fgMuted"
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

function ThresholdPreview({
  ruleType,
  raw,
}: {
  ruleType: string;
  raw: string;
}) {
  const summary = summariseThresholdConfig(ruleType, raw);
  const palette =
    summary.kind === "ok"
      ? { bg: "blue.subtle", border: "blue.emphasized", fg: "blue.fg", label: "Preview" }
      : summary.kind === "unsupported"
        ? {
            bg: "orange.subtle",
            border: "orange.emphasized",
            fg: "orange.fg",
            label: "Won't fire",
          }
        : { bg: "red.subtle", border: "red.emphasized", fg: "red.fg", label: "Invalid" };
  return (
    <Box
      borderWidth="1px"
      borderColor={palette.border}
      backgroundColor={palette.bg}
      padding={2}
      borderRadius="sm"
      marginTop={1}
    >
      <HStack alignItems="start" gap={2}>
        <Badge
          colorPalette={
            palette.label === "Won't fire"
              ? "orange"
              : palette.label === "Invalid"
                ? "red"
                : "blue"
          }
          size="xs"
          variant="subtle"
        >
          {palette.label}
        </Badge>
        <Text fontSize="xs" color={palette.fg} flex={1}>
          {summary.kind === "error" ? summary.message : summary.english}
        </Text>
      </HStack>
    </Box>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(AnomalyRulesPage),
);
