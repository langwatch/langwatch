// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  Code,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OttlEditor } from "@ee/governance/dashboard/components/OttlEditor";
import { isOttlEnabledSourceType } from "@ee/governance/services/activity-monitor/ottlStarterTemplates";

import { NON_ENTERPRISE_INGESTION_SOURCE_CAP } from "@ee/governance/services/activity-monitor/ingestionSource.constants";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Admin CRUD for IngestionSources — the per-platform fleet config that
 * powers the Activity Monitor pillar. One source per platform fleet
 * Wires to
 * api.ingestionSources.* per Sergey's slice 4.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

type Source = RouterOutputs["ingestionSources"]["list"][number];
type SourceType =
  | "otel_generic"
  | "claude_code"
  | "claude_cowork"
  | "workato"
  | "copilot_studio"
  | "openai_compliance"
  | "claude_compliance"
  | "s3_custom"
  | "http_custom";

const SOURCE_TYPE_OPTIONS: Array<{
  value: SourceType;
  label: string;
  mode: "push" | "pull" | "s3";
  blurb: string;
}> = [
  {
    value: "otel_generic",
    label: "Generic OTel",
    mode: "push",
    blurb:
      "Anything that speaks OTLP/HTTP. Simplest setup — paste an OTLP URL + bearer token into the upstream agent's exporter config.",
  },
  {
    value: "claude_code",
    label: "Claude Code (Anthropic OAuth)",
    mode: "push",
    blurb:
      "Native OTLP from Anthropic's Claude Code (the standalone CLI authed against an OAuth seat — distinct from the Cowork workspace path). Cost lands as a first-class signal via the claude_code.cost.usage metric + per-request claude_code.api_request events; no token-catalog lookup needed. Admins paste the bare endpoint into Claude Code's OTEL_EXPORTER_OTLP_ENDPOINT and the SDK suffixes /v1/logs and /v1/metrics itself.",
  },
  {
    value: "claude_cowork",
    label: "Anthropic Claude (Cowork)",
    mode: "push",
    blurb:
      "Claude Cowork pushes telemetry via OTLP. Configure under Anthropic Admin Console → Cowork → Telemetry.",
  },
  {
    value: "workato",
    label: "Workato",
    mode: "push",
    blurb:
      "Workato pushes job-completed webhooks. Generate an HMAC shared secret, paste into Workato → Connection Profile → Webhook destination.",
  },
  {
    value: "copilot_studio",
    label: "Microsoft Copilot Studio (Purview)",
    mode: "pull",
    blurb:
      "Polls Microsoft Purview Audit API for Copilot Studio activity. Needs an Azure AD app registration with `AuditLog.Read.All` permission.",
  },
  {
    value: "openai_compliance",
    label: "OpenAI Enterprise Compliance",
    mode: "s3",
    blurb:
      "Pulls compliance JSONL drops from an S3 bucket OpenAI writes to (Enterprise Compliance API).",
  },
  {
    value: "claude_compliance",
    label: "Anthropic Claude Enterprise Compliance",
    mode: "pull",
    blurb:
      "Polls Anthropic's compliance API with a workspace API key.",
  },
  {
    value: "s3_custom",
    label: "Custom S3 audit log",
    mode: "s3",
    blurb:
      "For homegrown agent systems writing audit logs to S3. Provide a parser DSL describing how each line maps to OCSF ActivityEvent fields.",
  },
  {
    value: "http_custom",
    label: "Custom HTTP audit-log API",
    mode: "pull",
    blurb:
      "Bring-your-own paginated REST audit-log API. Declare URL + auth + cursor + JSON-path field mappings; the universal HTTP-polling adapter handles paging + retries + OCSF fold.",
  },
];

const SOURCE_TYPE_LABEL: Record<SourceType, string> = Object.fromEntries(
  SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SourceType, string>;

const STATUS_META: Record<
  string,
  { icon: typeof CircleCheck; label: string; color: string }
> = {
  active: { icon: CircleCheck, label: "Active", color: "green.500" },
  awaiting_first_event: {
    icon: CircleDashed,
    label: "Awaiting first event",
    color: "amber.500",
  },
  disabled: { icon: CircleX, label: "Disabled", color: "fg.muted" },
};

interface ComposerState {
  sourceType: SourceType;
  name: string;
  description: string;
  parserConfig: Record<string, string>;
  /**
   * OTTL extraction statements applied by the aigateway before the
   * canonical extractor reads `langwatch.*` attributes. Only persisted
   * for OTTL-enabled source types (otel_generic + claude_code today);
   * pull-mode sources ignore.
   */
  ottlStatements: string[];
  /**
   * Phase 10: optional cron override for puller-mode sources. When the
   * source-type maps to a registered PullerAdapter, the composer
   * auto-fills this with the adapter's locked default schedule (15min
   * for copilot_studio); admins can edit before save. Ignored for
   * push/webhook source types.
   */
  pullSchedule: string;
}

/**
 * Maps user-facing pull-mode source-types onto the PullerAdapter id
 * registered server-side (`pullerAdapterRegistry.ids()`). Hardcoded
 * curated list per @ai_gateway_sergey_2's directive — keeps the UI
 * free of a round-trip enumeration call. Entries land in lockstep
 * with the reference adapters Sergey ships in `services/pullers/`.
 */
const PULL_ADAPTER_FOR_SOURCE: Partial<Record<SourceType, string>> = {
  copilot_studio: "copilot_studio",
  openai_compliance: "openai_compliance",
  claude_compliance: "claude_compliance",
  http_custom: "http_polling",
};

/**
 * Default cron schedule per puller adapter — mirrors the locked
 * `*_PULL_CONFIG.schedule` from the reference impl. Keeps the UI in
 * sync without a server round-trip; if the locked default ever
 * diverges, update both ends.
 */
const PULL_SCHEDULE_DEFAULTS: Record<string, string> = {
  copilot_studio: "*/15 * * * *",
  openai_compliance: "*/15 * * * *",
  claude_compliance: "*/15 * * * *",
  http_polling: "*/15 * * * *",
};

const blankComposer = (): ComposerState => ({
  sourceType: "otel_generic",
  name: "",
  description: "",
  parserConfig: {},
  ottlStatements: [],
  pullSchedule: "",
});

function fmtRelative(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function IngestionSourcesPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { isEnterprise } = useActivePlan();

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const refetch = () =>
    utils.ingestionSources.list.invalidate({ organizationId: orgId });

  const [composing, setComposing] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(blankComposer());
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [secretModal, setSecretModal] = useState<{
    title: string;
    secret: string;
    sourceId: string;
    sourceName: string;
    sourceType: SourceType;
  } | null>(null);

  const createMutation = api.ingestionSources.create.useMutation({
    onSuccess: (data) => {
      void refetch();
      setComposing(false);
      setComposer(blankComposer());
      setSecretModal({
        title: "Source created — paste this secret upstream",
        secret: data.ingestSecret,
        sourceId: data.source.id,
        sourceName: data.source.name,
        sourceType: data.source.sourceType as SourceType,
      });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to create source",
        description: e.message,
        type: "error",
      }),
  });

  const rotateMutation = api.ingestionSources.rotateSecret.useMutation({
    onSuccess: (data) => {
      void refetch();
      setSecretModal({
        title: "New secret minted — old one valid for 24h",
        secret: data.ingestSecret,
        sourceId: data.source.id,
        sourceName: data.source.name,
        sourceType: data.source.sourceType as SourceType,
      });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to rotate secret",
        description: e.message,
        type: "error",
      }),
  });

  const updateMutation = api.ingestionSources.update.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingSourceId(null);
      toaster.create({ title: "Source updated", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to update source",
        description: e.message,
        type: "error",
      }),
  });

  const archiveMutation = api.ingestionSources.archive.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Source archived", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to archive",
        description: e.message,
        type: "error",
      }),
  });

  const onSubmit = () => {
    if (!composer.name.trim()) return;
    const pullAdapter = PULL_ADAPTER_FOR_SOURCE[composer.sourceType];
    // For BYO `http_custom` we send the FULL HttpPollingConfig shape so the
    // generic adapter can run unmodified. The locked-shape reference pullers
    // (copilot_studio / openai_compliance / claude_compliance) only need the
    // adapter id — their validateConfig override returns the frozen config.
    const pullConfig =
      composer.sourceType === "http_custom"
        ? buildHttpCustomPullConfig(composer)
        : pullAdapter
          ? { adapter: pullAdapter }
          : null;
    if (composer.sourceType === "http_custom" && !pullConfig) {
      // buildHttpCustomPullConfig returns null when required fields are
      // empty — keep the drawer open so the user can fix the form.
      toaster.create({
        title: "Missing required HTTP source fields",
        description:
          "URL, auth header value, token, events JSONPath, cursor JSONPath, and event mapping are all required.",
        type: "error",
      });
      return;
    }
    createMutation.mutate({
      organizationId: orgId,
      sourceType: composer.sourceType,
      name: composer.name.trim(),
      description: composer.description.trim() || null,
      parserConfig: buildParserConfig(composer),
      pullConfig,
      pullSchedule: pullAdapter
        ? composer.pullSchedule.trim() ||
          PULL_SCHEDULE_DEFAULTS[pullAdapter] ||
          null
        : null,
    });
  };

  const grouped = useMemo(() => {
    const out: Record<"push" | "pull" | "s3", Source[]> = {
      push: [],
      pull: [],
      s3: [],
    };
    for (const s of sourcesQuery.data ?? []) {
      const meta = SOURCE_TYPE_OPTIONS.find((o) => o.value === s.sourceType);
      const mode = meta?.mode ?? "push";
      out[mode].push(s);
    }
    return out;
  }, [sourcesQuery.data]);


  return (
    <GovernanceLayout pageTitle="Ingestion Sources · Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <HStack gap={2}>
              <Heading size="md">Ingestion Sources</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm" maxW="3xl">
              Configure cross-platform feeds for the activity monitor.
              Each source maps an external AI platform into the
              normalised activity stream via OTel push, webhook, or
              S3 audit drops.{" "}
              <Link href="/governance" color="blue.600">
                Back to governance
              </Link>
              .
            </Text>
          </VStack>
          <Spacer />
          <VStack align="end" gap={1}>
            <Button
              size="sm"
              colorPalette="blue"
              disabled={
                !isEnterprise &&
                (sourcesQuery.data?.length ?? 0) >=
                  NON_ENTERPRISE_INGESTION_SOURCE_CAP
              }
              onClick={() => {
                setComposer(blankComposer());
                setComposing(true);
              }}
            >
              <Plus size={14} /> Add source
            </Button>
            {!isEnterprise && (
              <Text fontSize="xs" color="fg.muted">
                {sourcesQuery.data?.length ?? 0} /{" "}
                {NON_ENTERPRISE_INGESTION_SOURCE_CAP} sources used. Upgrade to
                Enterprise for unlimited.
              </Text>
            )}
          </VStack>
        </HStack>

        <SourceComposerDrawer
          isOpen={composing}
          organizationId={orgId}
          composer={composer}
          setComposer={setComposer}
          isPending={createMutation.isPending}
          onSubmit={onSubmit}
          onClose={() => {
            setComposing(false);
            setComposer(blankComposer());
          }}
        />

        {sourcesQuery.isLoading && <Spinner size="sm" />}

        {(["push", "pull", "s3"] as const).map((mode) => (
          <Box
            key={mode}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={4}
          >
            <HStack alignItems="start" marginBottom={3}>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="semibold">
                  {mode === "push"
                    ? "Push (OTLP / webhooks)"
                    : mode === "pull"
                      ? "Pull (admin API polling)"
                      : "S3 audit drops"}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {mode === "push"
                    ? "Upstream pushes events to LangWatch in near-real-time."
                    : mode === "pull"
                      ? "LangWatch polls upstream's admin API on a cadence."
                      : "LangWatch reads JSONL drops from an S3 bucket."}
                </Text>
              </VStack>
              <Spacer />
            </HStack>
            <VStack align="stretch" gap={2}>
              {grouped[mode].length === 0 && (
                <Text fontSize="sm" color="fg.muted">
                  No {mode}-mode sources configured.
                </Text>
              )}
              {grouped[mode].map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  isPendingRotate={
                    rotateMutation.isPending &&
                    rotateMutation.variables?.id === source.id
                  }
                  isPendingArchive={
                    archiveMutation.isPending &&
                    archiveMutation.variables?.id === source.id
                  }
                  onEdit={() => setEditingSourceId(source.id)}
                  onRotate={() =>
                    rotateMutation.mutate({
                      organizationId: orgId,
                      id: source.id,
                    })
                  }
                  onArchive={() =>
                    archiveMutation.mutate({
                      organizationId: orgId,
                      id: source.id,
                    })
                  }
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>

      <SecretModal
        details={secretModal}
        onClose={() => setSecretModal(null)}
      />

      <SourceEditDrawer
        organizationId={orgId}
        source={
          editingSourceId
            ? sourcesQuery.data?.find((s) => s.id === editingSourceId) ?? null
            : null
        }
        onClose={() => setEditingSourceId(null)}
        onSubmit={(input) => updateMutation.mutate(input)}
        isPending={updateMutation.isPending}
      />
    </GovernanceLayout>
  );
}

function SourceRow({
  source,
  isPendingRotate,
  isPendingArchive,
  onEdit,
  onRotate,
  onArchive,
}: {
  source: Source;
  isPendingRotate: boolean;
  isPendingArchive: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onArchive: () => void;
}) {
  const status = STATUS_META[source.status] ?? STATUS_META.awaiting_first_event!;
  const StatusIcon = status.icon;
  const typeLabel =
    SOURCE_TYPE_LABEL[source.sourceType as SourceType] ?? source.sourceType;
  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={3}
      gap={3}
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2}>
          <Link
            href={`/settings/governance/ingestion-sources/${source.id}`}
            color="fg"
            _hover={{ color: "orange.600" }}
          >
            <Text fontSize="sm" fontWeight="medium">
              {source.name}
            </Text>
          </Link>
          <Badge size="sm" variant="surface">
            {typeLabel}
          </Badge>
        </HStack>
        {source.description && (
          <Text fontSize="xs" color="fg.muted">
            {source.description}
          </Text>
        )}
        <HStack gap={2} marginTop={1}>
          <HStack gap={1}>
            <Box color={status.color} display="flex">
              <StatusIcon size={12} />
            </Box>
            <Text fontSize="xs" color="fg.muted">
              {status.label}
            </Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            · last event {fmtRelative(source.lastEventAt ?? null)}
          </Text>
        </HStack>
      </VStack>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        title="Edit source — name, description, OTTL statements"
      >
        <Pencil size={14} /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRotate}
        loading={isPendingRotate}
        title="Mint a new ingestSecret (24h grace on the old one)"
      >
        <RotateCw size={14} /> Rotate secret
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="red"
        onClick={onArchive}
        loading={isPendingArchive}
        title="Archive (preserves history)"
      >
        <Trash2 size={14} />
      </Button>
    </HStack>
  );
}

function SourceComposerDrawer({
  isOpen,
  organizationId,
  composer,
  setComposer,
  isPending,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  organizationId: string;
  composer: ComposerState;
  setComposer: (next: ComposerState) => void;
  isPending: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const meta = SOURCE_TYPE_OPTIONS.find((o) => o.value === composer.sourceType);
  // 4b-3 license gate: non-enterprise plans see only otel_generic.
  // Surfaces the available-tier list in the dropdown so the upsell
  // narrative aligns with the EnterpriseLockedSurface page-level gate
  // already shipped in 4b-2.
  const { isEnterprise } = useActivePlan();
  const sourceTypeOptions = isEnterprise
    ? SOURCE_TYPE_OPTIONS
    : SOURCE_TYPE_OPTIONS.filter((o) => o.value === "otel_generic");
  return (
    <Drawer.Root
      open={isOpen}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading as="h2" size="md">
            Add ingestion source
          </Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={3}>
            <HStack gap={3}>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Source type
            </Text>
            <select
              value={composer.sourceType}
              onChange={(e) =>
                setComposer({
                  ...composer,
                  sourceType: e.target.value as SourceType,
                  parserConfig: {},
                  ottlStatements: [],
                })
              }
              style={{
                padding: "8px",
                border: "1px solid var(--chakra-colors-border-muted)",
                borderRadius: "var(--chakra-radii-sm)",
                background: "white",
                fontSize: "14px",
              }}
            >
              {sourceTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} · {o.mode}
                </option>
              ))}
            </select>
            {!isEnterprise && (
              <Text fontSize="xs" color="fg.muted">
                Other source types are available on Enterprise plans.
              </Text>
            )}
          </VStack>
          <VStack align="stretch" gap={1} flex={2}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Display name
            </Text>
            <Input
              size="sm"
              backgroundColor="white"
              value={composer.name}
              onChange={(e) =>
                setComposer({ ...composer, name: e.target.value })
              }
              placeholder="Display name for this source"
            />
          </VStack>
        </HStack>
        {meta && (
          <Text fontSize="xs" color="fg.muted">
            {meta.blurb}
          </Text>
        )}
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
            placeholder="What this fleet covers + who owns it"
          />
        </VStack>

        <ParserConfigFields
          sourceType={composer.sourceType}
          values={composer.parserConfig}
          onChange={(parserConfig) => setComposer({ ...composer, parserConfig })}
        />

        <OttlEditor
          organizationId={organizationId}
          sourceType={composer.sourceType}
          statements={composer.ottlStatements}
          onChange={(ottlStatements) =>
            setComposer({ ...composer, ottlStatements })
          }
          enabled={isOttlEnabledSourceType(composer.sourceType)}
        />

        <PullScheduleField
          sourceType={composer.sourceType}
          value={composer.pullSchedule}
          onChange={(pullSchedule) => setComposer({ ...composer, pullSchedule })}
        />

          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack gap={3} width="full">
            <Spacer />
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={onSubmit}
              loading={isPending}
              disabled={!composer.name.trim()}
            >
              Create source
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Edit a previously-created IngestionSource. Scoped to the fields that
 * are safe to mutate without affecting the upstream operator's pasted
 * env block — name, description, parserConfig (incl. ottlStatements).
 *
 * Source type is immutable after create (changing it would invalidate
 * the upstream's running configuration); admins who need to change it
 * archive + recreate.
 */
function SourceEditDrawer({
  organizationId,
  source,
  onClose,
  onSubmit,
  isPending,
}: {
  organizationId: string;
  source: Source | null;
  onClose: () => void;
  onSubmit: (input: {
    organizationId: string;
    id: string;
    name: string;
    description: string | null;
    parserConfig: Record<string, unknown>;
  }) => void;
  isPending: boolean;
}) {
  const isOpen = !!source;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statements, setStatements] = useState<string[]>([]);

  // Sync local state when the drawer opens for a new source — drives
  // the form fields off whatever the row carries on the wire.
  useEffect(() => {
    if (!source) return;
    setName(source.name);
    setDescription(source.description ?? "");
    const parser = (source.parserConfig as Record<string, unknown>) ?? {};
    const raw = parser.ottlStatements;
    setStatements(
      Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string")
        : [],
    );
  }, [source?.id]);

  if (!source) {
    return (
      <Drawer.Root open={false} placement="end" onOpenChange={() => onClose()}>
        <Drawer.Content />
      </Drawer.Root>
    );
  }

  const handleSubmit = () => {
    if (!name.trim()) return;
    const parser = (source.parserConfig as Record<string, unknown>) ?? {};
    // Strip empty rows from the OTTL list and merge into the existing
    // parserConfig so we don't accidentally drop other fields the
    // adapter cares about (workspaceId, sharedSecretLastFour, …).
    const cleanedOttl = statements.filter((s) => s.trim().length > 0);
    const nextParser = {
      ...parser,
      ottlStatements: cleanedOttl.length > 0 ? cleanedOttl : undefined,
    };
    if (nextParser.ottlStatements === undefined) {
      delete nextParser.ottlStatements;
    }
    onSubmit({
      organizationId,
      id: source.id,
      name: name.trim(),
      description: description.trim() || null,
      parserConfig: nextParser,
    });
  };

  return (
    <Drawer.Root
      open={isOpen}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading as="h2" size="md">
            Edit source
          </Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={3}>
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Display name
              </Text>
              <Input
                size="sm"
                backgroundColor="white"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </VStack>
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Description (optional)
              </Text>
              <Textarea
                size="sm"
                backgroundColor="white"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </VStack>

            <OttlEditor
              organizationId={organizationId}
              sourceType={source.sourceType}
              statements={statements}
              onChange={setStatements}
              enabled={isOttlEnabledSourceType(source.sourceType)}
            />

            <Text fontSize="xs" color="fg.muted">
              Source type and ingest secret are immutable after create.
              Use “Rotate secret” for the secret; archive + recreate to
              change source type.
            </Text>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack gap={3} width="full">
            <Spacer />
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={handleSubmit}
              loading={isPending}
              disabled={!name.trim()}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  required?: boolean;
}

const PARSER_FIELDS: Record<SourceType, FieldDef[]> = {
  // No parser-config fields for generic OTel sources today — the
  // receiver accepts any well-formed OTLP/HTTP body. (Earlier copy
  // referenced a `LangWatchSourceType` attribute filter that the
  // normaliser doesn't actually implement; removed during bugbash so
  // the composer doesn't promise behaviour we don't ship.)
  otel_generic: [],
  // Claude Code's per-request shape is conveyed through OTTL statements
  // (parserConfig.ottlStatements), which the OttlEditor renders as its
  // own panel. No extra parser fields needed at the per-source level.
  claude_code: [],
  claude_cowork: [
    {
      key: "workspaceId",
      label: "Anthropic workspace ID",
      placeholder: "wsp_...",
      hint: "Find under Anthropic Admin Console → Workspace → Settings.",
      required: true,
    },
  ],
  workato: [
    {
      key: "sharedSecretLastFour",
      label: "Last 4 chars of the shared HMAC secret",
      placeholder: "e.g. a3f9",
      hint: "We auto-generate the HMAC secret + only store its hash. The last-4 helps you visually confirm which secret is configured upstream.",
      required: true,
    },
  ],
  copilot_studio: [
    {
      key: "tenantId",
      label: "Azure AD tenant ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientId",
      label: "App registration client ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientSecret",
      label: "App registration client secret",
      placeholder: "(value pasted from Azure portal)",
      hint: "We hash this server-side; only the hash is persisted.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
      hint: "How often to call Purview Audit. Default 300s.",
    },
  ],
  openai_compliance: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-openai-compliance",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "compliance/",
      hint: "OpenAI Enterprise Compliance writes JSONL files under this prefix.",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchComplianceReader",
      hint: "We assume this role to read the bucket. Trust policy must allow our account.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  claude_compliance: [
    {
      key: "workspaceApiKey",
      label: "Workspace API key",
      placeholder: "sk-ant-admin-...",
      hint: "Generate under Anthropic Admin Console → Compliance → Workspace API Keys. We hash this server-side.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
    },
  ],
  s3_custom: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-agent-audit",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "audit-logs/",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchAuditReader",
      required: true,
    },
    {
      key: "parserDsl",
      label: "Parser DSL (line → OCSF ActivityEvent mapping)",
      placeholder: "actor=$.user.email\naction=$.event_type\ntimestamp=$.ts",
      hint: "One field-mapping per line. Each maps an OCSF field to a JSONPath into the source line.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  http_custom: [
    {
      key: "url",
      label: "Audit-log endpoint URL",
      placeholder: "https://api.acme.com/v1/audit-log",
      hint: "Paginated REST endpoint that returns a JSON page of events plus a next-cursor.",
      required: true,
    },
    {
      key: "authHeaderName",
      label: "Auth header name",
      placeholder: "Authorization",
      hint: "Standard bearer flow: leave as Authorization. For x-api-key style auth, paste the header name.",
      required: true,
    },
    {
      key: "authHeaderValue",
      label: "Auth header value (template)",
      placeholder: "Bearer ${{credentials.token}}",
      hint: "Use ${{credentials.token}} where the secret should be substituted at request time. The token itself is captured in the next field.",
      required: true,
    },
    {
      key: "credentialsToken",
      label: "Bearer token / API key",
      placeholder: "(value pasted from the upstream admin console)",
      hint: "Persisted server-side; only the value is held in IngestionSource.pullConfig.credentials. Substituted into the header template at request time.",
      required: true,
    },
    {
      key: "eventsJsonPath",
      label: "Events array JSONPath",
      placeholder: "$.data",
      hint: "JSONPath into the response body to extract the events array (e.g. $.data, $.events, $.value).",
      required: true,
    },
    {
      key: "cursorJsonPath",
      label: "Next-cursor JSONPath",
      placeholder: "$.next_cursor",
      hint: "JSONPath to the pagination cursor in the response. Set to a path that yields null/missing when drained.",
      required: true,
    },
    {
      key: "cursorQueryParam",
      label: "Cursor query parameter name",
      placeholder: "cursor",
      hint: "Query-param name the upstream API expects on subsequent pages. Defaults to 'cursor'. Common alternatives: next_token, pageToken, $skiptoken.",
    },
    {
      key: "eventMappingDsl",
      label: "Event mapping (key=jsonpath per line)",
      placeholder:
        "source_event_id=$.id\nevent_timestamp=$.created_at\nactor=$.user.email\naction=$.event_type\ntarget=$.target.name",
      hint: "Required keys: source_event_id, event_timestamp, actor, action, target. Optional: cost_usd, tokens_input, tokens_output. Each line maps an OCSF field to a JSONPath into one event.",
      required: true,
    },
  ],
};

/**
 * Build the full `HttpPollingConfig`-shaped pullConfig for the
 * `http_custom` BYO source-type. Maps the form's parser-config fields
 * (auth header / token / JSONPaths / mapping DSL) onto the structured
 * shape that `HttpPollingPullerAdapter.validateConfig` expects.
 *
 * Returns null when required fields are missing — the caller should
 * keep the form open + surface the missing-field state via the existing
 * required-field markers rather than fire a dispatch that the worker
 * would reject at validateConfig time.
 */
function buildHttpCustomPullConfig(
  c: ComposerState,
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const url = (p.url ?? "").trim();
  const headerName = (p.authHeaderName ?? "Authorization").trim();
  const headerValue = (p.authHeaderValue ?? "").trim();
  const token = (p.credentialsToken ?? "").trim();
  const eventsPath = (p.eventsJsonPath ?? "").trim();
  const cursorPath = (p.cursorJsonPath ?? "").trim();
  const cursorParam = (p.cursorQueryParam ?? "").trim() || "cursor";
  const mappingDsl = (p.eventMappingDsl ?? "").trim();
  if (
    !url ||
    !headerValue ||
    !token ||
    !eventsPath ||
    !cursorPath ||
    !mappingDsl
  ) {
    return null;
  }
  const eventMapping: Record<string, string> = {};
  for (const line of mappingDsl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!k || !v) continue;
    eventMapping[k] = v;
  }
  return {
    adapter: "http_polling",
    url,
    method: "GET",
    headers: { [headerName]: headerValue },
    authMode: "header_template",
    cursorJsonPath: cursorPath,
    cursorQueryParam: cursorParam,
    eventsJsonPath: eventsPath,
    schedule:
      c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.http_polling || "*/15 * * * *",
    eventMapping,
    // Per HttpPollingPullerAdapter contract: caller-supplied secrets land
    // on `pullConfig.credentials.*` and the adapter substitutes them into
    // the header template via the `${{credentials.<key>}}` syntax.
    credentials: { token },
  };
}

function ParserConfigFields({
  sourceType,
  values,
  onChange,
}: {
  sourceType: SourceType;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const fields = PARSER_FIELDS[sourceType];
  if (fields.length === 0) return null;
  return (
    <VStack align="stretch" gap={3}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Source-specific configuration
      </Text>
      {fields.map((f) => (
        <VStack key={f.key} align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="medium">
            {f.label}
            {f.required && <Text as="span" color="red.500" marginLeft={1}>*</Text>}
          </Text>
          {f.key === "parserDsl" || f.key === "eventMappingDsl" ? (
            <Textarea
              size="sm"
              backgroundColor="white"
              rows={6}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              fontFamily="mono"
            />
          ) : (
            <Input
              size="sm"
              backgroundColor="white"
              type={
                f.key === "credentialsToken" ||
                f.key === "clientSecret" ||
                f.key === "workspaceApiKey"
                  ? "password"
                  : "text"
              }
              value={values[f.key] ?? ""}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              placeholder={f.placeholder}
            />
          )}
          {f.hint && (
            <Text fontSize="xs" color="fg.muted">
              {f.hint}
            </Text>
          )}
        </VStack>
      ))}
    </VStack>
  );
}

function PullScheduleField({
  sourceType,
  value,
  onChange,
}: {
  sourceType: SourceType;
  value: string;
  onChange: (next: string) => void;
}) {
  const adapter = PULL_ADAPTER_FOR_SOURCE[sourceType];
  if (!adapter) return null;
  const defaultSchedule = PULL_SCHEDULE_DEFAULTS[adapter] ?? "";
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Polling schedule
      </Text>
      <Input
        size="sm"
        backgroundColor="white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultSchedule}
        fontFamily="mono"
      />
      <Text fontSize="xs" color="fg.muted">
        Standard 5-field cron. Leave blank to use the adapter default
        (<code>{defaultSchedule}</code>). The puller worker honors this on
        the next BullMQ tick after save.
      </Text>
    </VStack>
  );
}

function buildParserConfig(c: ComposerState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.parserConfig)) {
    if (v == null || v === "") continue;
    if (k === "pollEverySec") {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k] = n;
      continue;
    }
    out[k] = v;
  }
  // Strip empty rows from the OTTL statement list — admins may leave a
  // blank trailing row from clicking "Add statement"; persisting it
  // would force the gateway parser to handle empty input as an error.
  const ottl = c.ottlStatements
    .map((s) => s)
    .filter((s) => s.trim().length > 0);
  if (ottl.length > 0) {
    out.ottlStatements = ottl;
  }
  return out;
}

function SecretModal({
  details,
  onClose,
}: {
  details: {
    title: string;
    secret: string;
    sourceId: string;
    sourceName: string;
    sourceType: SourceType;
  } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://langwatch.invalid";
  const otlpUrl = details
    ? `${baseUrl}/api/ingest/otel/${details.sourceId}`
    : "";
  const webhookUrl = details
    ? `${baseUrl}/api/ingest/webhook/${details.sourceId}`
    : "";
  const usesPushUrl =
    details?.sourceType === "otel_generic" ||
    details?.sourceType === "claude_cowork" ||
    details?.sourceType === "claude_code";
  const usesWebhookUrl = details?.sourceType === "workato";
  const isClaudeCode = details?.sourceType === "claude_code";

  // Claude Code's monitoring-usage doc requires both
  // CLAUDE_CODE_ENABLE_TELEMETRY=1 and the standard OTEL_*_EXPORTER
  // env vars before any signals are emitted. Pre-build the shell
  // export block so admins paste once instead of stitching six lines
  // off the docs page. SDK suffixes /v1/logs + /v1/metrics off the
  // base endpoint.
  const claudeCodeEnvBlock = useMemo(() => {
    if (!isClaudeCode || !details) return "";
    return [
      `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
      `export OTEL_LOGS_EXPORTER=otlp`,
      `export OTEL_METRICS_EXPORTER=otlp`,
      `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      `export OTEL_EXPORTER_OTLP_ENDPOINT="${otlpUrl}"`,
      `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${details.secret}"`,
    ].join("\n");
  }, [isClaudeCode, details, otlpUrl]);

  // F-OTEL-3 (Sergey draft): a copy-paste curl that exercises the full
  // happy path — body parses, attribute parser sees the canonical
  // gen_ai.* + user.email keys, KPI strip moves on the first event.
  // Timestamp is fresh at modal open so the test event lands inside
  // the 24h health window even if the user delays a bit before
  // pasting.
  const testCurl = useMemo(() => {
    if (!details) return null;
    if (usesPushUrl) {
      const nowNs = `${Date.now()}000000`;
      const otlpBody = JSON.stringify({
        resource_spans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: details.sourceName },
                },
              ],
            },
            scope_spans: [
              {
                spans: [
                  {
                    name: "chat.completion",
                    startTimeUnixNano: nowNs,
                    attributes: [
                      {
                        key: "gen_ai.usage.input_tokens",
                        value: { intValue: 120 },
                      },
                      {
                        key: "gen_ai.usage.output_tokens",
                        value: { intValue: 480 },
                      },
                      {
                        key: "gen_ai.usage.cost_usd",
                        value: { doubleValue: 0.025 },
                      },
                      { key: "user.email", value: { stringValue: "you@your.org" } },
                      {
                        key: "gen_ai.request.model",
                        value: { stringValue: "claude-sonnet-4" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      return [
        `curl -X POST '${otlpUrl}' \\`,
        `  -H 'Authorization: Bearer ${details.secret}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${otlpBody}'`,
      ].join("\n");
    }
    if (usesWebhookUrl) {
      return [
        `curl -X POST '${webhookUrl}' \\`,
        `  -H 'Authorization: Bearer ${details.secret}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '{"event":"test.smoke","actor":"you@your.org"}'`,
      ].join("\n");
    }
    return null;
  }, [
    details?.secret,
    details?.sourceName,
    details,
    otlpUrl,
    webhookUrl,
    usesPushUrl,
    usesWebhookUrl,
  ]);

  if (!details) return null;

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DialogRoot
      open
      onOpenChange={(e) => !e.open && onClose()}
      closeOnInteractOutside={false}
    >
      <DialogContent maxWidth="2xl">
        <DialogHeader>
          <DialogTitle>
            <HStack gap={2}>
              <KeyRound size={16} />
              <Text>{details.title}</Text>
            </HStack>
          </DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              This is the only time we&apos;ll show this secret. Save it
              somewhere safe and paste it into the upstream platform&apos;s
              admin console. We store only its hash.
            </Text>
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Source name
              </Text>
              <Text fontSize="sm" fontWeight="medium">
                {details.sourceName}{" "}
                <Badge size="sm" variant="surface" marginLeft={2}>
                  {SOURCE_TYPE_LABEL[details.sourceType]}
                </Badge>
              </Text>
            </VStack>
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Ingest secret (bearer token)
              </Text>
              <HStack gap={2}>
                <Code
                  flex={1}
                  padding={2}
                  fontSize="xs"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                >
                  {details.secret}
                </Code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy(details.secret)}
                >
                  <Copy size={14} /> {copied ? "Copied" : "Copy"}
                </Button>
              </HStack>
            </VStack>
            {usesPushUrl && (
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  OTLP ingestion endpoint (paste into upstream exporter)
                </Text>
                <HStack gap={2}>
                  <Code flex={1} padding={2} fontSize="xs">
                    {otlpUrl}
                  </Code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(otlpUrl)}
                  >
                    <Copy size={14} />
                  </Button>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  Spans push into the LangWatch trace store with this
                  source&apos;s origin tag and become viewable in the
                  trace viewer. If you are sending agent traces from
                  your own LangWatch SDK, use{" "}
                  <Code fontSize="xs">/api/otel/v1/traces</Code> with
                  your project API key — different auth, same trace
                  store. See{" "}
                  <Link
                    href="https://docs.langwatch.ai/observability/trace-vs-activity-ingestion"
                    color="blue.600"
                  >
                    Choosing the right OTel endpoint
                  </Link>
                  .
                </Text>
              </VStack>
            )}
            {usesWebhookUrl && (
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Webhook URL (paste into upstream webhook config)
                </Text>
                <HStack gap={2}>
                  <Code flex={1} padding={2} fontSize="xs">
                    {webhookUrl}
                  </Code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(webhookUrl)}
                  >
                    <Copy size={14} />
                  </Button>
                </HStack>
              </VStack>
            )}
            {isClaudeCode && (
              <VStack align="stretch" gap={1}>
                <HStack justify="space-between" alignItems="center">
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                    Claude Code shell env block
                  </Text>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => copy(claudeCodeEnvBlock)}
                  >
                    <Copy size={12} /> Copy block
                  </Button>
                </HStack>
                <Code
                  padding={3}
                  fontSize="xs"
                  whiteSpace="pre"
                  display="block"
                  overflowX="auto"
                >
                  {claudeCodeEnvBlock}
                </Code>
                <Text fontSize="xs" color="fg.muted">
                  Paste into your Claude Code shell, then run{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    claude
                  </Code>
                  . Claude Code&apos;s SDK appends{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    /v1/logs
                  </Code>{" "}
                  and{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    /v1/metrics
                  </Code>{" "}
                  itself off the base endpoint. To attribute spend to a
                  specific team or cost center, also export{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    OTEL_RESOURCE_ATTRIBUTES=team.id=…,cost_center=…
                  </Code>
                  {" "}— those land as resource attributes and slot into
                  /governance&apos;s spendByTeam without further config.
                </Text>
              </VStack>
            )}
            {testCurl && (
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Test it now — paste this into a terminal
                </Text>
                <Box position="relative">
                  <Code
                    display="block"
                    padding={3}
                    fontSize="xs"
                    whiteSpace="pre"
                    overflowX="auto"
                  >
                    {testCurl}
                  </Code>
                  <Button
                    size="xs"
                    variant="outline"
                    position="absolute"
                    top={2}
                    right={2}
                    onClick={() => copy(testCurl)}
                  >
                    <Copy size={12} /> {copied ? "Copied" : "Copy"}
                  </Button>
                </Box>
                <Text fontSize="xs" color="fg.muted">
                  Returns HTTP 202 with{" "}
                  <Code fontSize="xs">events: 1</Code> on success. If you
                  get <Code fontSize="xs">events: 0</Code> with a hint,
                  the body shape didn&apos;t parse — check the docs.
                </Text>
              </VStack>
            )}
            <Box
              borderWidth="1px"
              borderColor="amber.300"
              backgroundColor="amber.50"
              padding={3}
              borderRadius="sm"
            >
              <Text fontSize="xs" color="amber.900">
                <strong>Important:</strong> the secret above will not be
                shown again. We retained the prior secret&apos;s hash for a
                24h grace window if you&apos;re rotating, so you have time
                to roll the new value through every upstream client.
              </Text>
            </Box>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <Link
            href={`/settings/governance/ingestion-sources/${details.sourceId}`}
          >
            <Button variant="outline">View source page →</Button>
          </Link>
          <Button colorPalette="blue" onClick={onClose}>
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("organization:manage", { bypassOnboardingRedirect: true })(
    IngestionSourcesPage,
  ),
);
