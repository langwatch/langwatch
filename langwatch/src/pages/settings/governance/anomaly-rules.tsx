import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Anomaly rules admin authoring surface — the rules whose firings
 * surface on /settings/governance ("Active anomaly alerts" section).
 *
 * v0 (this iter): mocked-only. No tRPC procedure invoked. Local state
 * holds the rule list; form submissions toast "saved — not persisted".
 * The page header carries a "Preview · mocked data" badge so admins
 * understand the limitation. Once Sergey's anomaly-detection backend
 * (Option C) lands, the MOCK_RULES + local-state setters are replaced
 * by api.anomalyRules.* tRPC calls — mechanical migration since the
 * UI is mock-shaped to the same wire schema we expect.
 *
 * Schema disclaimer: ruleType / severity / destination / thresholdJson
 * are open enums or free-form on the UI side. The backend slice may
 * lock the contract; we'll align then.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */

type Severity = "critical" | "warning" | "info";
type Destination = "slack" | "email" | "webhook" | "pagerduty";

interface AnomalyRule {
  id: string;
  name: string;
  severity: Severity;
  ruleType: string;
  scopeType: "organization" | "team" | "project" | "user" | "sourceType";
  scopeId: string;
  thresholdJson: string;
  destinations: Destination[];
  enabled: boolean;
  lastFiredAtIso: string | null;
}

const RULE_TYPE_OPTIONS = [
  { value: "spend-spike", label: "Spend spike (vs baseline)" },
  { value: "unusual-model", label: "Unusual model (outside allowlist)" },
  { value: "tool-policy-violation", label: "Tool policy violation" },
  { value: "new-user-burst", label: "New-user burst spend" },
  { value: "weekend-activity", label: "Weekend off-hours activity" },
  { value: "custom", label: "Custom (free-form thresholdJson)" },
];

const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; tone: string }
> = {
  critical: { label: "Critical", color: "red.600", tone: "red" },
  warning: { label: "Warning", color: "orange.500", tone: "orange" },
  info: { label: "Info", color: "blue.600", tone: "blue" },
};

const SCOPE_OPTIONS = [
  { value: "organization", label: "Organization" },
  { value: "team", label: "Team" },
  { value: "project", label: "Project" },
  { value: "user", label: "User" },
  { value: "sourceType", label: "IngestionSource type" },
] as const;

const THRESHOLD_TEMPLATES: Record<string, string> = {
  "spend-spike": JSON.stringify(
    {
      windowSec: 86400,
      ratioVsBaseline: 2.0,
      minBaselineUsd: 10,
    },
    null,
    2,
  ),
  "unusual-model": JSON.stringify(
    {
      allowedModelGlobs: ["gpt-5-*", "claude-3-*"],
    },
    null,
    2,
  ),
  "tool-policy-violation": JSON.stringify(
    {
      blockedToolPatterns: ["filesystem.*", "network.*"],
    },
    null,
    2,
  ),
  "new-user-burst": JSON.stringify(
    {
      windowSec: 86400,
      thresholdUsd: 50,
      newAccountWithinDays: 7,
    },
    null,
    2,
  ),
  "weekend-activity": JSON.stringify(
    {
      ratioVsWeekday: 1.5,
    },
    null,
    2,
  ),
  custom: "{}",
};

const TEMPLATES: Array<{
  key: string;
  ruleType: string;
  severity: Severity;
  description: string;
  defaults: Partial<AnomalyRule>;
}> = [
  {
    key: "weekend-spend-spike",
    ruleType: "spend-spike",
    severity: "warning",
    description: "Flag spending > 2× weekday avg on Sat/Sun.",
    defaults: {
      name: "Weekend spend spike",
      ruleType: "spend-spike",
      severity: "warning",
      scopeType: "organization",
      destinations: ["slack"],
    },
  },
  {
    key: "unusual-model",
    ruleType: "unusual-model",
    severity: "info",
    description: "Flag any model outside the configured allowlist.",
    defaults: {
      name: "Unusual model",
      ruleType: "unusual-model",
      severity: "info",
      scopeType: "organization",
      destinations: ["slack"],
    },
  },
  {
    key: "tool-policy-violation",
    ruleType: "tool-policy-violation",
    severity: "critical",
    description: "Flag any virtual-key call to a blocked tool pattern.",
    defaults: {
      name: "Tool policy violation",
      ruleType: "tool-policy-violation",
      severity: "critical",
      scopeType: "organization",
      destinations: ["slack", "pagerduty"],
    },
  },
  {
    key: "new-user-burst",
    ruleType: "new-user-burst",
    severity: "warning",
    description: "Flag a brand-new user spending > $50 in 24h.",
    defaults: {
      name: "New-user burst spend",
      ruleType: "new-user-burst",
      severity: "warning",
      scopeType: "organization",
      destinations: ["email"],
    },
  },
];

const MOCK_RULES: AnomalyRule[] = [
  {
    id: "rule_weekend_spike",
    name: "Weekend spend spike",
    severity: "warning",
    ruleType: "spend-spike",
    scopeType: "sourceType",
    scopeId: "workato",
    thresholdJson: THRESHOLD_TEMPLATES["spend-spike"]!,
    destinations: ["slack"],
    enabled: true,
    lastFiredAtIso: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: "rule_unusual_model",
    name: "Unusual model — outside allowlist",
    severity: "warning",
    ruleType: "unusual-model",
    scopeType: "organization",
    scopeId: "miro",
    thresholdJson: THRESHOLD_TEMPLATES["unusual-model"]!,
    destinations: ["slack", "email"],
    enabled: true,
    lastFiredAtIso: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: "rule_tool_policy",
    name: "Tool policy — filesystem.* blocked",
    severity: "critical",
    ruleType: "tool-policy-violation",
    scopeType: "organization",
    scopeId: "miro",
    thresholdJson: THRESHOLD_TEMPLATES["tool-policy-violation"]!,
    destinations: ["slack", "pagerduty"],
    enabled: true,
    lastFiredAtIso: null,
  },
];

interface ComposerState {
  id?: string;
  name: string;
  severity: Severity;
  ruleType: string;
  scopeType: AnomalyRule["scopeType"];
  scopeId: string;
  thresholdJson: string;
  destinations: Destination[];
}

const blankComposer = (severity: Severity = "warning"): ComposerState => ({
  name: "",
  severity,
  ruleType: "spend-spike",
  scopeType: "organization",
  scopeId: "",
  thresholdJson: THRESHOLD_TEMPLATES["spend-spike"]!,
  destinations: ["slack"],
});

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

function AnomalyRulesPage() {
  const { project } = useOrganizationTeamProject({ redirectToOnboarding: false });
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  const [rules, setRules] = useState<AnomalyRule[]>(MOCK_RULES);
  const [composing, setComposing] = useState<{
    severity: Severity;
    composer: ComposerState;
  } | null>(null);

  const grouped = useMemo(() => {
    const out: Record<Severity, AnomalyRule[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    for (const r of rules) out[r.severity].push(r);
    return out;
  }, [rules]);

  const startNew = (severity: Severity) =>
    setComposing({ severity, composer: blankComposer(severity) });

  const startTemplate = (templateKey: string) => {
    const t = TEMPLATES.find((x) => x.key === templateKey);
    if (!t) return;
    setComposing({
      severity: t.severity,
      composer: {
        name: t.defaults.name ?? "",
        severity: t.defaults.severity ?? "warning",
        ruleType: t.defaults.ruleType ?? "spend-spike",
        scopeType: t.defaults.scopeType ?? "organization",
        scopeId: "",
        thresholdJson: THRESHOLD_TEMPLATES[t.ruleType] ?? "{}",
        destinations: t.defaults.destinations ?? ["slack"],
      },
    });
  };

  const startEdit = (rule: AnomalyRule) =>
    setComposing({
      severity: rule.severity,
      composer: {
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        ruleType: rule.ruleType,
        scopeType: rule.scopeType,
        scopeId: rule.scopeId,
        thresholdJson: rule.thresholdJson,
        destinations: rule.destinations,
      },
    });

  const onSubmit = () => {
    if (!composing) return;
    const c = composing.composer;
    if (!c.name.trim()) return;
    if (c.id) {
      setRules((prev) =>
        prev.map((r) =>
          r.id === c.id
            ? {
                ...r,
                name: c.name.trim(),
                severity: c.severity,
                ruleType: c.ruleType,
                scopeType: c.scopeType,
                scopeId: c.scopeId,
                thresholdJson: c.thresholdJson,
                destinations: c.destinations,
              }
            : r,
        ),
      );
      toaster.create({
        title: "Edit saved (v0 — not persisted)",
        type: "info",
      });
    } else {
      const id = `rule_${Date.now().toString(36)}`;
      const next: AnomalyRule = {
        id,
        name: c.name.trim(),
        severity: c.severity,
        ruleType: c.ruleType,
        scopeType: c.scopeType,
        scopeId: c.scopeId,
        thresholdJson: c.thresholdJson,
        destinations: c.destinations,
        enabled: true,
        lastFiredAtIso: null,
      };
      setRules((prev) => [next, ...prev]);
      toaster.create({
        title: "Rule saved (v0 — not persisted)",
        type: "info",
      });
    }
    setComposing(null);
  };

  const onToggle = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  const onDelete = (id: string) => {
    if (!confirm("Delete this rule? Existing firings stay in the audit log.")) {
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== id));
    toaster.create({
      title: "Rule deleted (v0 — not persisted)",
      type: "info",
    });
  };

  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  const isEmpty = rules.length === 0;

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading as="h2" size="lg">
                Anomaly Rules
              </Heading>
              <Badge colorPalette="purple" variant="subtle">
                Preview · mocked data
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm" maxW="3xl">
              Define the rules whose firings surface on the{" "}
              <Link
                href="/settings/governance"
                color="orange.600"
                _hover={{ textDecoration: "underline" }}
              >
                governance overview
              </Link>{" "}
              page&apos;s active-alerts section. One rule = one threshold +
              scope + destination tuple.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <Box
          borderWidth="1px"
          borderColor="amber.300"
          backgroundColor="amber.50"
          padding={3}
          borderRadius="md"
        >
          <Text fontSize="sm" color="amber.900">
            <strong>v0 caveat:</strong> rules persist once the
            anomaly-detection backend lands. This page is a UX preview —
            create / edit / delete actions stay in browser state only,
            no tRPC procedure is invoked.
          </Text>
        </Box>

        {isEmpty && (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={5}
          >
            <HStack gap={2} marginBottom={3}>
              <Sparkles size={16} />
              <Text fontWeight="medium">
                No anomaly rules yet — pick a starting template
              </Text>
            </HStack>
            <Text fontSize="sm" color="fg.muted" marginBottom={3}>
              These templates encode the most common asks we&apos;ve heard
              from enterprise customers.
            </Text>
            <HStack gap={3} wrap="wrap">
              {TEMPLATES.map((t) => (
                <Box
                  key={t.key}
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="md"
                  padding={3}
                  flex="1 0 240px"
                  cursor="pointer"
                  _hover={{ borderColor: "orange.300" }}
                  onClick={() => startTemplate(t.key)}
                >
                  <HStack gap={2}>
                    <Badge colorPalette={SEVERITY_META[t.severity].tone} size="sm">
                      {t.severity}
                    </Badge>
                    <Text fontSize="sm" fontWeight="medium">
                      {t.defaults.name}
                    </Text>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted" marginTop={1}>
                    {t.description}
                  </Text>
                </Box>
              ))}
            </HStack>
          </Box>
        )}

        {composing && (
          <RuleComposer
            composer={composing.composer}
            setComposer={(next) =>
              setComposing(
                composing ? { ...composing, composer: next } : null,
              )
            }
            onSubmit={onSubmit}
            onCancel={() => setComposing(null)}
            isEdit={!!composing.composer.id}
          />
        )}

        {(["critical", "warning", "info"] as const).map((sev) => (
          <Box
            key={sev}
            as="section"
            role="region"
            aria-label={`${SEVERITY_META[sev].label} anomaly rules (${grouped[sev].length})`}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={4}
          >
            <HStack alignItems="start" marginBottom={3}>
              <VStack align="start" gap={0}>
                <HStack gap={2}>
                  <Box color={SEVERITY_META[sev].color}>
                    <AlertTriangle size={16} />
                  </Box>
                  <Text fontSize="sm" fontWeight="semibold">
                    {SEVERITY_META[sev].label}
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
                onClick={() => startNew(sev)}
                disabled={!!composing}
              >
                <Plus size={14} /> New rule
              </Button>
            </HStack>

            <VStack align="stretch" gap={2}>
              {grouped[sev].length === 0 && (
                <Text fontSize="sm" color="fg.muted">
                  No {SEVERITY_META[sev].label.toLowerCase()} rules.
                </Text>
              )}
              {grouped[sev].map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={() => onToggle(rule.id)}
                  onEdit={() => startEdit(rule)}
                  onDelete={() => onDelete(rule.id)}
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </SettingsLayout>
  );
}

function RuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: AnomalyRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={3}
      gap={3}
      opacity={rule.enabled ? 1 : 0.55}
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2} wrap="wrap">
          <Text fontSize="sm" fontWeight="medium">
            {rule.name}
          </Text>
          <Badge size="sm" variant="surface">
            {rule.ruleType}
          </Badge>
          {!rule.enabled && (
            <Badge size="sm" variant="surface" colorPalette="gray">
              Disabled
            </Badge>
          )}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          scope: {rule.scopeType}
          {rule.scopeId ? ` · ${rule.scopeId}` : ""}
          {" · "}
          destinations: {rule.destinations.join(", ") || "none"}
          {" · "}
          last fired: {fmtRelative(rule.lastFiredAtIso)}
        </Text>
      </VStack>
      <Switch
        checked={rule.enabled}
        onCheckedChange={onToggle}
        size="sm"
      />
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil size={14} /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="red"
        onClick={onDelete}
        title="Delete rule"
      >
        <Trash2 size={14} />
      </Button>
    </HStack>
  );
}

function RuleComposer({
  composer,
  setComposer,
  onSubmit,
  onCancel,
  isEdit,
}: {
  composer: ComposerState;
  setComposer: (next: ComposerState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isEdit: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="blue.300"
      borderRadius="md"
      padding={4}
      backgroundColor="blue.50"
    >
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm" fontWeight="semibold">
          {isEdit ? "Edit anomaly rule" : "New anomaly rule"}
        </Text>
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
              placeholder="e.g. Weekend spend spike"
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
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </VStack>
        </HStack>
        <HStack gap={3}>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Rule type
            </Text>
            <select
              value={composer.ruleType}
              onChange={(e) =>
                setComposer({
                  ...composer,
                  ruleType: e.target.value,
                  thresholdJson:
                    THRESHOLD_TEMPLATES[e.target.value] ?? composer.thresholdJson,
                })
              }
              style={selectStyle}
            >
              {RULE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </VStack>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Scope type
            </Text>
            <select
              value={composer.scopeType}
              onChange={(e) =>
                setComposer({
                  ...composer,
                  scopeType: e.target.value as ComposerState["scopeType"],
                })
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
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Scope ID
            </Text>
            <Input
              size="sm"
              backgroundColor="white"
              value={composer.scopeId}
              onChange={(e) =>
                setComposer({ ...composer, scopeId: e.target.value })
              }
              placeholder={
                composer.scopeType === "sourceType"
                  ? "workato / cowork / ..."
                  : composer.scopeType === "organization"
                    ? "(blank = whole org)"
                    : `${composer.scopeType}_...`
              }
            />
          </VStack>
        </HStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Threshold config (rule-type-specific JSON)
          </Text>
          <Textarea
            size="sm"
            backgroundColor="white"
            rows={6}
            fontFamily="mono"
            value={composer.thresholdJson}
            onChange={(e) =>
              setComposer({ ...composer, thresholdJson: e.target.value })
            }
          />
          <Text fontSize="xs" color="fg.muted">
            v0 placeholder schema. Backend C-slice may revise the field
            shape; on lock, this composer migrates to a typed editor per
            ruleType.
          </Text>
        </VStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Destinations
          </Text>
          <HStack gap={3} wrap="wrap">
            {(["slack", "email", "webhook", "pagerduty"] as Destination[]).map(
              (d) => {
                const checked = composer.destinations.includes(d);
                return (
                  <HStack
                    key={d}
                    gap={2}
                    cursor="pointer"
                    onClick={() => {
                      const next = checked
                        ? composer.destinations.filter((x) => x !== d)
                        : [...composer.destinations, d];
                      setComposer({ ...composer, destinations: next });
                    }}
                  >
                    <Box
                      width="14px"
                      height="14px"
                      borderRadius="sm"
                      borderWidth="1px"
                      borderColor={checked ? "blue.500" : "border.emphasis"}
                      backgroundColor={checked ? "blue.500" : "transparent"}
                      color="white"
                      fontSize="9px"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      {checked && "✓"}
                    </Box>
                    <Text fontSize="sm">{d}</Text>
                  </HStack>
                );
              },
            )}
          </HStack>
        </VStack>

        <HStack gap={3}>
          <Spacer />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            colorPalette="blue"
            onClick={onSubmit}
            disabled={!composer.name.trim()}
          >
            {isEdit ? "Save changes" : "Create rule"}
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

const selectStyle = {
  padding: "8px",
  border: "1px solid var(--chakra-colors-border-muted)",
  borderRadius: "var(--chakra-radii-sm)",
  background: "white",
  fontSize: "14px",
};

export default withPermissionGuard("organization:manage", {})(
  AnomalyRulesPage,
);
