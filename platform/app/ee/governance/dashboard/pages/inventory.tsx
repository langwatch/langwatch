// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  Code,
  Collapsible,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AddIngestionSourceMenu } from "@ee/governance/dashboard/components/AddIngestionSourceMenu";
import {
  groupForMode,
  SOURCE_GROUP_META,
  SOURCE_TYPE_LABEL,
  SOURCE_TYPE_OPTIONS,
  type SourceGroup,
  type SourceType,
  SourceTypeIconGlyph,
} from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import { OttlEditor } from "@ee/governance/dashboard/components/OttlEditor";
import { PullCadenceField } from "@ee/governance/dashboard/components/PullCadenceField";
import {
  composerCadenceError,
  PULL_ADAPTER_FOR_SOURCE,
  PULL_SCHEDULE_DEFAULTS,
} from "@ee/governance/dashboard/logic/pullCadence";
import { NON_ENTERPRISE_INGESTION_SOURCE_CAP } from "@ee/governance/services/activity-monitor/ingestionSource.constants";
import { isOttlEnabledSourceType } from "@ee/governance/services/activity-monitor/ottlStarterTemplates";
import {
  ChevronRight,
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
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { ToolCatalogPanel } from "~/components/governance/ToolCatalogPanel";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
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
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Admin CRUD for IngestionSources - the per-platform fleet config that
 * powers the Activity Monitor pillar. One source per platform fleet
 * Wires to
 * api.ingestionSources.* per Sergey's slice 4.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

type Source = RouterOutputs["ingestionSources"]["list"][number];
/** The one-time secret reveal, shown after a create or a rotate. */
type SecretDetails = {
  title: string;
  secret: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
};
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

export interface ComposerState {
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
   * Cron override for puller-mode sources. Stays "" while the admin
   * leaves the Cadence picker untouched — meaning "the recommended
   * schedule", which `buildCreateInput` resolves to an explicit cron at
   * create (a stored null would mean the source never runs). Ignored
   * for push/webhook source types.
   */
  pullSchedule: string;
}

const blankComposer = (): ComposerState => ({
  sourceType: "otel_generic",
  name: "",
  description: "",
  parserConfig: {},
  ottlStatements: [],
  pullSchedule: "",
});

function fmtRelative(date: Date | string | null): string {
  if (!date) return "-";
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

/**
 * The pull config the create call should carry, or `null` when the form is not
 * yet valid. Returning a wrapper rather than the bare config keeps "no pull
 * config for this source type" (a valid `{ pullConfig: null }`) distinct from
 * "the form is wrong" (`null`), which a bare return would collapse.
 */
function resolvePullConfig(
  composer: ComposerState,
  { requireCredentials = true }: { requireCredentials?: boolean } = {},
): { pullConfig: Record<string, unknown> | null } | null {
  const pullAdapter = PULL_ADAPTER_FOR_SOURCE[composer.sourceType];
  // For BYO `http_custom` we send the FULL HttpPollingConfig shape so the
  // generic adapter can run unmodified. The locked-shape reference pullers
  // (copilot_studio / openai_compliance / claude_compliance) only need the
  // adapter id - their validateConfig override returns the frozen config.
  const builders: Partial<
    Record<SourceType, [() => unknown | null, string, string]>
  > = {
    http_custom: [
      () => buildHttpCustomPullConfig(composer),
      "Missing required HTTP source fields",
      "URL, auth header value, token, events JSONPath, cursor JSONPath, and event mapping are all required.",
    ],
    databricks_genie: [
      () => buildDatabricksGeniePullConfig(composer),
      "Missing required Databricks fields",
      "Workspace URL is required, plus a way to sign in: either a workspace token, or a service principal's client ID and secret together.",
    ],
    anthropic_admin: [
      () => buildAnthropicAdminPullConfig(composer, { requireCredentials }),
      "Missing or invalid Anthropic fields",
      requireCredentials
        ? "Admin API key is required, report must be `usage` or `cost`, bucket width is usage-only and must be 1m/1h/1d, and the backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z)."
        : "Report must be `usage` or `cost`, bucket width is usage-only and must be 1m/1h/1d, and the backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z). Leave the admin API key blank to keep the current one.",
    ],
  };

  const builder = builders[composer.sourceType];
  if (builder) {
    const [build, title, description] = builder;
    const pullConfig = build();
    if (!pullConfig) {
      toaster.create({ title, description, type: "error" });
      return null;
    }
    return { pullConfig: pullConfig as Record<string, unknown> };
  }
  return { pullConfig: pullAdapter ? { adapter: pullAdapter } : null };
}

function InventoryHeader() {
  return (
    <HStack gap={2}>
      <Heading size="md">Inventory</Heading>
      <Badge colorPalette="purple" size="sm" variant="surface">
        Preview
      </Badge>
    </HStack>
  );
}

/**
 * The id a per-row mutation is currently working on, so a row can show its own
 * spinner without every row spinning. Null while idle.
 */
function pendingId(mutation: {
  isPending: boolean;
  variables?: { id: string } | undefined;
}): string | null {
  return mutation.isPending ? (mutation.variables?.id ?? null) : null;
}

function SourceGroupSection({
  group,
  sources,
  knowsFleetIsEmpty,
  rotatingId,
  archivingId,
  canManage,
  onEdit,
  onRotate,
  onArchive,
}: {
  group: SourceGroup;
  sources: Source[];
  knowsFleetIsEmpty: boolean;
  rotatingId: string | null;
  archivingId: string | null;
  canManage: boolean;
  onEdit: (id: string) => void;
  onRotate: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const { title, blurb } = SOURCE_GROUP_META[group];
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <HStack alignItems="start" marginBottom={3}>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="semibold">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {blurb}
          </Text>
        </VStack>
        <Spacer />
      </HStack>
      <VStack align="stretch" gap={2}>
        {sources.length === 0 && knowsFleetIsEmpty && (
          <Text fontSize="sm" color="fg.muted">
            No sources configured here yet.
          </Text>
        )}
        {sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            isPendingRotate={rotatingId === source.id}
            isPendingArchive={archivingId === source.id}
            canManage={canManage}
            onEdit={() => onEdit(source.id)}
            onRotate={() => onRotate(source.id)}
            onArchive={() => onArchive(source.id)}
          />
        ))}
      </VStack>
    </Box>
  );
}

/**
 * The source list: what the viewer may read, what went wrong when it could
 * not be read, the two delivery-group sections, and the note naming the
 * grant that unlocks the writes.
 */
function IngestionSourceList({
  canRead,
  canManage,
  isLoading,
  error,
  grouped,
  rotatingId,
  archivingId,
  onEdit,
  onRotate,
  onArchive,
}: {
  canRead: boolean;
  canManage: boolean;
  isLoading: boolean;
  error: unknown;
  grouped: Record<SourceGroup, Source[]>;
  rotatingId: string | null;
  archivingId: string | null;
  onEdit: (id: string) => void;
  onRotate: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <>
      {!canRead && (
        <PermissionRequiredNotice
          permission="ingestionSources:view"
          detail="The source list stays hidden until then."
        />
      )}

      {isLoading && <Spinner size="sm" />}

      {/* The list is the page. Without this the group sections below
          render "No sources configured here yet." off an empty `?? []`,
          which tells an admin their entire ingest fleet is gone when all
          that actually happened was a 403 or a DB blip. */}
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load ingestion sources"
      />

      {canRead &&
        (["realtime", "scheduled"] as const).map((group) => (
          <SourceGroupSection
            key={group}
            group={group}
            sources={grouped[group]}
            // Only claim "none configured" when we actually know: on a load
            // failure the alert above says what went wrong instead.
            knowsFleetIsEmpty={!error}
            rotatingId={rotatingId}
            archivingId={archivingId}
            canManage={canManage}
            onEdit={onEdit}
            onRotate={onRotate}
            onArchive={onArchive}
          />
        ))}

      {canRead && !canManage && (
        <PermissionRequiredNotice
          permission="ingestionSources:manage"
          detail="You can read the sources. Adding, editing, rotating a secret, and archiving need this grant."
        />
      )}
    </>
  );
}

/**
 * The create payload for the composer, or `null` when the form is not ready —
 * either unnamed, or carrying a pull config the adapter cannot honour (which
 * `resolvePullConfig` has already toasted about).
 */
export function buildCreateInput({
  composer,
  organizationId,
}: {
  composer: ComposerState;
  organizationId: string;
}) {
  if (!composer.name.trim()) return null;
  const resolved = resolvePullConfig(composer);
  if (!resolved) return null;
  const pullAdapter = PULL_ADAPTER_FOR_SOURCE[composer.sourceType];
  return {
    organizationId,
    sourceType: composer.sourceType,
    name: composer.name.trim(),
    description: composer.description.trim() || null,
    parserConfig: buildParserConfig(composer),
    pullConfig: resolved.pullConfig,
    pullSchedule: pullAdapter
      ? composer.pullSchedule.trim() ||
        PULL_SCHEDULE_DEFAULTS[pullAdapter] ||
        null
      : null,
  };
}

/** Sources split into the two group sections the page renders. */
function useGroupedSources(sources: Source[] | undefined) {
  return useMemo(() => {
    const out: Record<SourceGroup, Source[]> = {
      realtime: [],
      scheduled: [],
    };
    for (const s of sources ?? []) {
      const meta = SOURCE_TYPE_OPTIONS.find((o) => o.value === s.sourceType);
      out[groupForMode(meta?.mode ?? "push")].push(s);
    }
    return out;
  }, [sources]);
}

/** The four mutations the page drives, with their toasts and cache busting. */
function useIngestionSourceMutations({
  refetch,
  setComposing,
  setComposer,
  setEditingSourceId,
  setSecretModal,
}: {
  refetch: () => unknown;
  setComposing: (open: boolean) => void;
  setComposer: (next: ComposerState) => void;
  setEditingSourceId: (id: string | null) => void;
  setSecretModal: (details: SecretDetails | null) => void;
}) {
  const create = api.ingestionSources.create.useMutation({
    onSuccess: (data) => {
      void refetch();
      setComposing(false);
      setComposer(blankComposer());
      setSecretModal({
        title: "Source created - paste this secret upstream",
        secret: data.ingestSecret,
        sourceId: data.source.id,
        sourceName: data.source.name,
        sourceType: data.source.sourceType as SourceType,
      });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't create the source" }),
  });

  const rotate = api.ingestionSources.rotateSecret.useMutation({
    onSuccess: (data) => {
      void refetch();
      setSecretModal({
        title: "New secret minted - old one valid for 24h",
        secret: data.ingestSecret,
        sourceId: data.source.id,
        sourceName: data.source.name,
        sourceType: data.source.sourceType as SourceType,
      });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't rotate the secret" }),
  });

  const update = api.ingestionSources.update.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingSourceId(null);
      toaster.create({ title: "Source updated", type: "success" });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't update the source" }),
  });

  const archive = api.ingestionSources.archive.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Source archived", type: "success" });
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't archive the source",
      }),
  });

  return { create, rotate, update, archive };
}

/**
 * Everything the page needs: the org it is scoped to, the source list, the
 * composer/edit/secret state and the mutations that drive them. State and
 * callbacks only — the component owns the markup.
 */
function useIngestionSourcesPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { isEnterprise } = useActivePlan();
  const canRead = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("ingestionSources:manage");
  // The Catalog pane's own grant — decides the inventory default tab.
  const canManageCatalog = hasAnyPermission("aiTools:manage");

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && canRead, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const refetch = () =>
    utils.ingestionSources.list.invalidate({ organizationId: orgId });

  const [composing, setComposing] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(blankComposer());
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [secretModal, setSecretModal] = useState<SecretDetails | null>(null);

  const mutations = useIngestionSourceMutations({
    refetch,
    setComposing,
    setComposer,
    setEditingSourceId,
    setSecretModal,
  });

  const onSubmit = () => {
    const input = buildCreateInput({ composer, organizationId: orgId });
    // A null input means a required field is missing or malformed;
    // resolvePullConfig has already said which, and the drawer stays open so
    // the user can fix it.
    if (input) mutations.create.mutate(input);
  };

  /**
   * Open the composer on a fresh draft for the picked type — a draft left
   * over from a different type must never leak its parser or OTTL state
   * into this one.
   */
  const startComposer = (sourceType: SourceType) => {
    setComposer({ ...blankComposer(), sourceType });
    setComposing(true);
  };

  /** Close the composer and drop the draft. */
  const closeComposer = () => {
    setComposing(false);
    setComposer(blankComposer());
  };

  return {
    orgId,
    isEnterprise,
    canRead,
    canManage,
    canManageCatalog,
    startComposer,
    closeComposer,
    sourcesQuery,
    grouped: useGroupedSources(sourcesQuery.data),
    composing,
    setComposing,
    composer,
    setComposer,
    editingSourceId,
    setEditingSourceId,
    secretModal,
    setSecretModal,
    mutations,
    onSubmit,
  };
}

/**
 * The inventory's tabs: Catalog (the tool-tiles editor, formerly
 * /governance/tool-catalog) and Sources (the ingestion-sources table).
 */
const INVENTORY_TABS = ["catalog", "sources"] as const;
type InventoryTab = (typeof INVENTORY_TABS)[number];

const isInventoryTab = (value: string | null): value is InventoryTab =>
  INVENTORY_TABS.some((tab) => tab === value);

/**
 * A selected non-default tab is part of the address (?tab=); the default
 * stays out of it, and an unknown or stale value degrades to the default
 * instead of a blank pane. The default is permission-sensitive — Catalog
 * for aiTools:manage holders, Sources otherwise — so the BARE address
 * means "your default pane" and can resolve differently for different
 * recipients of the same link. Accepted deliberately (see the spec): the
 * ?tab= form is the stable shareable address.
 */
function useInventoryTab({ defaultTab }: { defaultTab: InventoryTab }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const inventoryTab = isInventoryTab(requestedTab) ? requestedTab : defaultTab;
  const selectInventoryTab = (tab: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === defaultTab) next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  return { inventoryTab, selectInventoryTab };
}

/**
 * The inventory's tab shell. The Catalog pane mounts the tool-tiles
 * editor; the Sources pane renders the children (the sources table) under
 * an optional actions row (the add-source control, which belongs beside
 * the list it adds to).
 */
function InventoryTabs({
  defaultTab,
  sourcesActions,
  children,
}: {
  defaultTab: InventoryTab;
  sourcesActions?: ReactNode;
  children: ReactNode;
}) {
  const { inventoryTab, selectInventoryTab } = useInventoryTab({ defaultTab });
  return (
    <Tabs.Root
      value={inventoryTab}
      onValueChange={({ value }) => selectInventoryTab(value)}
      variant="line"
      lazyMount
    >
      <Tabs.List>
        <Tabs.Trigger
          value="catalog"
          color="fg.muted"
          _selected={{ color: "fg", fontWeight: "semibold" }}
        >
          Catalog
        </Tabs.Trigger>
        <Tabs.Trigger
          value="sources"
          color="fg.muted"
          _selected={{ color: "fg", fontWeight: "semibold" }}
        >
          Sources
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="catalog" paddingTop={4}>
        <ToolCatalogPanel />
      </Tabs.Content>
      <Tabs.Content value="sources" paddingTop={4}>
        <VStack align="stretch" gap={4} width="full">
          {sourcesActions}
          {children}
        </VStack>
      </Tabs.Content>
    </Tabs.Root>
  );
}

function InventoryPage() {
  const {
    orgId,
    isEnterprise,
    canRead,
    canManage,
    canManageCatalog,
    startComposer,
    closeComposer,
    sourcesQuery,
    grouped,
    composing,
    composer,
    setComposer,
    editingSourceId,
    setEditingSourceId,
    secretModal,
    setSecretModal,
    mutations,
    onSubmit,
  } = useIngestionSourcesPage();

  return (
    <GovernanceLayout pageTitle="Inventory · Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <InventoryHeader />
        <SourceComposerDrawer
          isOpen={composing}
          organizationId={orgId}
          composer={composer}
          setComposer={setComposer}
          isPending={mutations.create.isPending}
          onSubmit={onSubmit}
          onClose={closeComposer}
        />

        <InventoryTabs
          defaultTab={canManageCatalog ? "catalog" : "sources"}
          sourcesActions={
            canManage ? (
              <SourcesActionsRow
                isEnterprise={isEnterprise}
                sourceCount={sourcesQuery.data?.length ?? 0}
                onAdd={startComposer}
              />
            ) : undefined
          }
        >
          <IngestionSourceList
            canRead={canRead}
            canManage={canManage}
            isLoading={sourcesQuery.isLoading}
            error={sourcesQuery.error}
            grouped={grouped}
            rotatingId={pendingId(mutations.rotate)}
            archivingId={pendingId(mutations.archive)}
            onEdit={setEditingSourceId}
            onRotate={(id) =>
              mutations.rotate.mutate({ organizationId: orgId, id })
            }
            onArchive={(id) =>
              mutations.archive.mutate({ organizationId: orgId, id })
            }
          />
        </InventoryTabs>
      </VStack>

      <SecretModal details={secretModal} onClose={() => setSecretModal(null)} />

      <EditingSourceDrawer
        orgId={orgId}
        editingSourceId={editingSourceId}
        setEditingSourceId={setEditingSourceId}
        sourcesQuery={sourcesQuery}
        update={mutations.update}
      />
    </GovernanceLayout>
  );
}

/** The edit drawer, resolved from the id the list put in page state. */
function EditingSourceDrawer({
  orgId,
  editingSourceId,
  setEditingSourceId,
  sourcesQuery,
  update,
}: {
  orgId: string;
  editingSourceId: string | null;
  setEditingSourceId: (id: string | null) => void;
  sourcesQuery: ReturnType<typeof useIngestionSourcesPage>["sourcesQuery"];
  update: ReturnType<typeof useIngestionSourcesPage>["mutations"]["update"];
}) {
  return (
    <SourceEditDrawer
      organizationId={orgId}
      source={
        editingSourceId
          ? (sourcesQuery.data?.find((s) => s.id === editingSourceId) ?? null)
          : null
      }
      onClose={() => setEditingSourceId(null)}
      onSubmit={(input) => update.mutate(input)}
      isPending={update.isPending}
    />
  );
}

/**
 * The right-aligned add-source row at the top of the Sources pane.
 * Mounted only for `ingestionSources:manage` holders — a viewer who only
 * reads is not offered a composer the server refuses.
 */
function SourcesActionsRow({
  isEnterprise,
  sourceCount,
  onAdd,
}: {
  isEnterprise: boolean;
  sourceCount: number;
  onAdd: (sourceType: SourceType) => void;
}) {
  return (
    <HStack>
      <Spacer />
      <AddSourceControl
        isEnterprise={isEnterprise}
        sourceCount={sourceCount}
        onAdd={onAdd}
      />
    </HStack>
  );
}

/** Mounted only for a viewer holding `ingestionSources:manage`. */
function AddSourceControl({
  isEnterprise,
  sourceCount,
  onAdd,
}: {
  isEnterprise: boolean;
  sourceCount: number;
  onAdd: (sourceType: SourceType) => void;
}) {
  const atCap =
    !isEnterprise && sourceCount >= NON_ENTERPRISE_INGESTION_SOURCE_CAP;
  return (
    <AddIngestionSourceMenu
      isEnterprise={isEnterprise}
      disabledReason={
        atCap
          ? "Source limit reached. Upgrade to Enterprise for unlimited sources."
          : undefined
      }
      hint={
        !isEnterprise
          ? `Your plan includes up to ${NON_ENTERPRISE_INGESTION_SOURCE_CAP} sources. Upgrade to Enterprise for unlimited.`
          : undefined
      }
      onPick={onAdd}
    >
      <Button variant="outline" size="sm" disabled={atCap}>
        <Plus size={14} /> Add source
      </Button>
    </AddIngestionSourceMenu>
  );
}

function SourceRow({
  source,
  isPendingRotate,
  isPendingArchive,
  onEdit,
  onRotate,
  onArchive,
  canManage,
}: {
  source: Source;
  isPendingRotate: boolean;
  isPendingArchive: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onArchive: () => void;
  canManage: boolean;
}) {
  const status =
    STATUS_META[source.status] ?? STATUS_META.awaiting_first_event!;
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
            href={`/governance/inventory/${source.id}`}
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
      {canManage && (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            title="Edit source - name, description, OTTL statements"
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
        </>
      )}
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
  // The type was picked from the Add source menu, which is where the plan
  // gate lives (see gatedSourceTypeOptions) — the composer is committed to
  // it. Changing type means closing and picking again, exactly like the
  // model-provider drawer.
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
          <HStack gap={3}>
            <SourceTypeIconGlyph sourceType={composer.sourceType} size="24px" />
            <Heading as="h2" size="md">
              Add {meta?.label ?? "ingestion source"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={3}>
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Display name
              </Text>
              <Input
                size="sm"
                value={composer.name}
                onChange={(e) =>
                  setComposer({ ...composer, name: e.target.value })
                }
                placeholder="Display name for this source"
              />
            </VStack>
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
              onChange={(parserConfig) =>
                setComposer({ ...composer, parserConfig })
              }
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

            <PullCadenceField
              sourceType={composer.sourceType}
              value={composer.pullSchedule}
              onChange={(pullSchedule) =>
                setComposer({ ...composer, pullSchedule })
              }
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
              disabled={
                !composer.name.trim() ||
                composerCadenceError({
                  sourceType: composer.sourceType,
                  pullSchedule: composer.pullSchedule,
                }) !== null
              }
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
 * The edit form's local state, seeded from the row each time the drawer opens
 * on a different source.
 *
 * Split out from the drawer because seeding is the half with the reasoning in
 * it — which fields the row can answer, and which the DTO deliberately cannot
 * — while the drawer below is chrome. Keeping them in one function meant every
 * read of the markup scrolled past the seeding rules first.
 */
function useSourceEditForm(source: Source | null) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statements, setStatements] = useState<string[]>([]);
  const [parserConfig, setParserConfig] = useState<Record<string, string>>({});
  const [pullSchedule, setPullSchedule] = useState("");

  // Sync local state when the drawer opens for a new source - drives
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
    setParserConfig(
      seedComposerParserConfig({
        sourceType: source.sourceType as SourceType,
        storedParserConfig: parser,
      }),
    );
    // The `pullSchedule` column is not on the DTO, but the adapter's own copy
    // of it rides along inside parserConfig, written there by the composer on
    // create. Seeding from it keeps the field showing the cadence that is
    // actually running rather than an empty box that reads as "no schedule".
    setPullSchedule(typeof parser.schedule === "string" ? parser.schedule : "");
  }, [source?.id]);

  return {
    name,
    setName,
    description,
    setDescription,
    statements,
    setStatements,
    parserConfig,
    setParserConfig,
    pullSchedule,
    setPullSchedule,
  };
}

/** The two fields every source has, whatever its type. */
function SourceIdentityFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
}: {
  name: string;
  onNameChange: (next: string) => void;
  description: string;
  onDescriptionChange: (next: string) => void;
}) {
  return (
    <>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Display name
        </Text>
        <Input
          size="sm"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </VStack>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Description (optional)
        </Text>
        <Textarea
          size="sm"
          rows={2}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </VStack>
    </>
  );
}

/**
 * The adapter half of the edit form: the pull config fields plus the cadence,
 * rendered only for a source type the form knows how to rebuild.
 */
function PullConfigEditFields({
  sourceType,
  parserConfig,
  onParserConfigChange,
  pullSchedule,
  onPullScheduleChange,
  hasPulled,
}: {
  sourceType: SourceType;
  parserConfig: Record<string, string>;
  onParserConfigChange: (next: Record<string, string>) => void;
  pullSchedule: string;
  onPullScheduleChange: (next: string) => void;
  /** Whether the source already holds a poller cursor. */
  hasPulled: boolean;
}) {
  return (
    <>
      <ParserConfigFields
        sourceType={sourceType}
        values={parserConfig}
        onChange={onParserConfigChange}
        mode="edit"
        readOnlyKeys={hasPulled ? ["startingAt"] : undefined}
      />
      {hasPulled && (
        <Text fontSize="xs" color="fg.muted">
          The backfill start is fixed once a source has pulled: the cursor has
          already moved past it and never rewinds. To re-read older data,
          archive this source and create a new one with an earlier start.
        </Text>
      )}
      <PullCadenceField
        sourceType={sourceType}
        value={pullSchedule}
        onChange={onPullScheduleChange}
      />
    </>
  );
}

/**
 * Edit a previously-created IngestionSource: name, description, OTTL, and —
 * for a pull source the form knows how to rebuild — the adapter configuration
 * and cadence the poller actually runs on.
 *
 * Shared by the source list and the source detail page, so the two cannot
 * drift into offering different edits of the same row.
 *
 * Source type is immutable after create (changing it would invalidate the
 * upstream's running configuration); admins who need to change it archive +
 * recreate.
 */
export function SourceEditDrawer({
  organizationId,
  source,
  onClose,
  onSubmit,
  isPending,
}: {
  organizationId: string;
  source: Source | null;
  onClose: () => void;
  onSubmit: (input: EditSubmission) => void;
  isPending: boolean;
}) {
  const isOpen = !!source;
  const form = useSourceEditForm(source);

  // The DTO carries `sourceType` as a bare string; every lookup below is keyed
  // by `SourceType`, and an unknown value simply misses every table rather
  // than throwing — which is the behaviour we want for a row written by a
  // newer deploy than the one serving this page.
  const sourceType = source?.sourceType as SourceType | undefined;
  const isPullMode = isEditablePullSource(sourceType);

  // A source holding no cursor has its backfill start genuinely still in play.
  // Once one exists the usage cursor never rewinds, so the setting would be
  // accepted and then ignored — it is shown read-only rather than offered as a
  // lie. This reads the row's own answer rather than inferring one from
  // `status`, which is wrong in both directions: a pull that succeeded with
  // zero events leaves the source `awaiting_first_event` holding a cursor, and
  // a source disabled before its first run never minted one.
  const hasPulled = source?.hasPollerCursor ?? false;

  if (!source) {
    return (
      <Drawer.Root open={false} placement="end" onOpenChange={() => onClose()}>
        <Drawer.Content />
      </Drawer.Root>
    );
  }

  const handleSubmit = () => {
    const submission = buildEditSubmission({
      organizationId,
      source,
      name: form.name,
      description: form.description,
      parserConfig: form.parserConfig,
      ottlStatements: form.statements,
      pullSchedule: form.pullSchedule,
    });
    // null is a form that is not saveable — an empty name, or a pull field the
    // adapter cannot parse, which has already told the admin which one.
    if (!submission) return;
    onSubmit(submission);
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
            <SourceIdentityFields
              name={form.name}
              onNameChange={form.setName}
              description={form.description}
              onDescriptionChange={form.setDescription}
            />

            {isPullMode && (
              <PullConfigEditFields
                sourceType={sourceType}
                parserConfig={form.parserConfig}
                onParserConfigChange={form.setParserConfig}
                pullSchedule={form.pullSchedule}
                onPullScheduleChange={form.setPullSchedule}
                hasPulled={hasPulled}
              />
            )}

            <OttlEditor
              organizationId={organizationId}
              sourceType={source.sourceType}
              statements={form.statements}
              onChange={form.setStatements}
              enabled={isOttlEnabledSourceType(source.sourceType)}
            />

            <Text fontSize="xs" color="fg.muted">
              {isPullMode
                ? "Source type is immutable after create — archive and recreate to change it."
                : "Source type and ingest secret are immutable after create. Use “Rotate secret” for the secret; archive + recreate to change source type."}
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
              disabled={!form.name.trim()}
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
  /**
   * True when this field's value is a secret: something that must be
   * masked as the admin types it AND kept out of the plaintext
   * `parserConfig` JSONB (it belongs only inside the encrypted
   * `credentials` subtree). This is the single declaration both of those
   * decisions are driven from - see `isSecretFieldKey` below for why
   * that matters.
   */
  secret?: boolean;
  /**
   * True for fields most admins never need: rendered inside a collapsed
   * "Advanced" group so the form leads with the required path. Leaving
   * every advanced field untouched must always produce a working source.
   */
  advanced?: boolean;
}

/**
 * Which form the parser-config fields are being rendered on. The only field
 * that behaves differently is a secret: mandatory and typed in front of you on
 * create, never shown and optional on edit, where blank means "keep the stored
 * one". Everything else — validation, masking, storage routing — is shared.
 */
export type ParserConfigMode = "create" | "edit";

export const PARSER_FIELDS: Record<SourceType, FieldDef[]> = {
  // No parser-config fields for generic OTel sources today - the
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
      secret: true,
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
      secret: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
    },
  ],
  anthropic_admin: [
    {
      // `credentials*` prefix routes this into the encrypted `credentials`
      // subtree — same rule as the Genie token below.
      key: "credentialsToken",
      label: "Admin API key",
      placeholder: "sk-ant-admin-...",
      hint: "Generate under Anthropic Admin Console → API Keys → Admin Keys. A regular workspace key returns 401 on the organization reports. We encrypt this server-side.",
      required: true,
      secret: true,
    },
    {
      key: "report",
      label: "Report (usage or cost)",
      placeholder: "cost",
      hint: "Exactly one per source. `cost` carries Anthropic's own reported spend (Priority Tier usage is excluded, so it is close to but not the invoice); `usage` pulls token counts that we price ourselves. Never create both reports for the same organization — the same spend would be counted twice.",
      required: true,
    },
    {
      key: "bucketWidth",
      label: "Bucket width (optional, usage report only)",
      placeholder: "1d",
      hint: "1m, 1h or 1d. Only affects the usage report; cost is always daily. Default 1d.",
    },
    {
      key: "startingAt",
      label: "Backfill start (optional)",
      placeholder: "2026-08-01",
      hint: "The date the first run reads from: `2026-08-01`, or an instant carrying a timezone (`2026-08-01T00:00:00Z`). A time without a timezone is rejected rather than read as yours. Empty = 3 calendar days back at midnight UTC for cost, 1 calendar day back at midnight UTC for usage.",
    },
  ],
  databricks_genie: [
    {
      key: "workspaceUrl",
      label: "Workspace URL",
      placeholder: "https://adb-1234567890123456.7.azuredatabricks.net",
      required: true,
    },
    {
      // Named `credentials*` on purpose: `buildParserConfig` routes every
      // `credentials*` field into the `credentials` subtree, which is the ONLY
      // part of parserConfig the server encrypts before it reaches the
      // database. A field named `clientId` would sit in the JSONB in plaintext.
      key: "credentialsClientId",
      label: "Service principal client ID",
      placeholder: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      hint: "The source signs in with this service principal at the start of every run. It needs Can Manage on every Genie space you want covered — read access is not enough. Databricks only returns other people's conversations to an identity that can manage the space, so a weaker one records nothing and reports no error.",
      secret: true,
    },
    {
      key: "credentialsClientSecret",
      label: "Service principal secret",
      placeholder: "dose...",
      hint: "The OAuth secret for that service principal. We encrypt this server-side.",
      secret: true,
    },
    {
      key: "credentialsToken",
      label: "Workspace token",
      placeholder: "dapi...",
      hint: "A personal access token, pasted instead of the service principal client ID and secret; when both are given, the token wins. Databricks expires these about an hour after issuing them, so a source that runs on a schedule is dead by the next morning — only use a token for a one-off backfill. It needs the same Can Manage on every Genie space. We encrypt this server-side.",
      secret: true,
      advanced: true,
    },
    {
      key: "spaceIds",
      label: "Genie space IDs (optional)",
      placeholder: "Leave empty to cover every space the credential can see",
      hint: "Comma-separated. Empty is the usual setting — every space the credential can see is covered, including spaces created later.",
      advanced: true,
    },
    {
      key: "warehouseId",
      label: "SQL warehouse ID (optional)",
      advanced: true,
      placeholder: "095eb666b2ed2762",
      hint: "Any warehouse this credential can run a query on. It is where the billing lookup itself runs — NOT the warehouse being priced, which is every warehouse the questions used. Set it to attribute the compute behind each question to the person who asked; leave it empty and questions are recorded at zero cost, which is what Genie itself charges. Naming one makes every run submit a query, so a stopped warehouse is started and billed on the source's schedule. The token additionally needs SELECT on the `system` catalogue, which only a metastore admin can grant — without it questions are still recorded, without cost. The figure is a share of the hourly bill at list prices, so it is an estimate, not the invoice.",
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
      secret: true,
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

const SECRET_FIELD_KEYS = new Set(
  Object.values(PARSER_FIELDS)
    .flat()
    .filter((f) => f.secret)
    .map((f) => f.key),
);

/**
 * "Is this field a secret" used to be answered two different ways in this
 * file: an exact-match allowlist decided whether the input rendered masked,
 * and a separate `key.startsWith("credentials")` check in `parserFieldValue`
 * decided whether the value was routed into the encrypted `credentials`
 * subtree instead of the plaintext `parserConfig`. They happened to agree on
 * every field that existed at the time, but nothing forced them to keep
 * agreeing - a future field could satisfy one rule and not the other, and
 * the two ways that can go wrong are both bad: a genuinely secret value
 * rendered in plaintext on screen, or a plausibly-secret-looking value
 * persisted to Postgres unencrypted because it missed the `credentials*`
 * naming convention.
 *
 * This is now the ONE place that decision gets made. Both the input-masking
 * render and the parserConfig storage routing call this function, driven
 * first by the explicit `secret: true` declaration on the `FieldDef` (the
 * source of truth - see the doc comment on `FieldDef.secret`), with the
 * `credentials` prefix kept only as a belt-and-braces fallback so an
 * undeclared `credentials*` field still can't slip through and leak.
 */
export function isSecretFieldKey(key: string): boolean {
  return SECRET_FIELD_KEYS.has(key) || key.startsWith("credentials");
}

/**
 * Build the full `HttpPollingConfig`-shaped pullConfig for the
 * `http_custom` BYO source-type. Maps the form's parser-config fields
 * (auth header / token / JSONPaths / mapping DSL) onto the structured
 * shape that `HttpPollingPullerAdapter.validateConfig` expects.
 *
 * Returns null when required fields are missing - the caller should
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
      c.pullSchedule.trim() ||
      PULL_SCHEDULE_DEFAULTS.http_polling ||
      "*/15 * * * *",
    eventMapping,
    // Per HttpPollingPullerAdapter contract: caller-supplied secrets land
    // on `pullConfig.credentials.*` and the adapter substitutes them into
    // the header template via the `${{credentials.<key>}}` syntax.
    credentials: { token },
  };
}

/**
 * The Anthropic Admin adapter config, or null when a required field is empty
 * or `report` is not one of the two values the adapter accepts. Nothing
 * validates pullConfig against the adapter schema at save time — a bad value
 * here would sit in the row looking fine and fail on every pull — so the
 * builder is the last checkpoint before the database.
 *
 * `requireCredentials` is the one thing that differs between creating a source
 * and editing one, and it defaults to the stricter case. On create there is no
 * stored secret to fall back on, so a blank token is a broken source. On edit
 * the secret is never shown — `toDto` strips it — so a blank token means
 * "leave it alone", and the key must be OMITTED rather than emitted empty:
 * `updateSource` carries the stored envelope across only for a key that is
 * genuinely absent, so `credentials: { token: "" }` would overwrite a working
 * key with an empty one and break the source on its next run.
 *
 * Every other check stays shared. Forking a second builder for the edit form
 * is how the two paths would drift into disagreeing about what a valid bucket
 * width is.
 */
export function buildAnthropicAdminPullConfig(
  c: ComposerState,
  { requireCredentials = true }: { requireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const token = trimmedField(p, "credentialsToken");
  const report = trimmedField(p, "report").toLowerCase();
  if (!token && requireCredentials) return null;
  if (report !== "usage" && report !== "cost") return null;

  const bucketWidth = validBucketWidth(trimmedField(p, "bucketWidth"), report);
  if (bucketWidth === null) return null;

  const startingAt = normalizeStartingAt(trimmedField(p, "startingAt"));
  if (startingAt === null) return null;

  return {
    adapter: "anthropic_admin",
    report,
    ...(bucketWidth ? { bucketWidth } : {}),
    ...(startingAt ? { startingAt } : {}),
    schedule:
      c.pullSchedule.trim() ||
      PULL_SCHEDULE_DEFAULTS.anthropic_admin ||
      "0 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/** One composer field, trimmed, with an absent key reading as empty. */
function trimmedField(p: Record<string, string>, key: string): string {
  return (p[key] ?? "").trim();
}

/**
 * The bucket width to store, or null when it is one the adapter will not honour.
 *
 * Only the usage report reads this. The cost report pins `1d` — the puller sends
 * `COST_REPORT_BUCKET_WIDTH` and deliberately ignores `config.bucketWidth` — so
 * saving `1m` on a cost source writes a setting that silently never applies, and
 * the form's own hint already promises the opposite.
 *
 * Empty yields undefined (the field is optional); rejected yields null.
 */
function validBucketWidth(
  raw: string,
  report: string,
): string | null | undefined {
  if (!raw) return undefined;
  if (report !== "usage") return null;
  return ["1m", "1h", "1d"].includes(raw) ? raw : null;
}

/** Whether y-m-d is a date that exists, rather than one Date would roll forward. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * A bare `YYYY-MM-DD`, or a timestamp carrying an explicit offset. Anything else
 * is rejected rather than guessed.
 *
 * The two shapes are the ones `Date.parse` reads unambiguously. An offset-less
 * `2026-08-01T00:00` is spec'd as *local* time, so the same typed value would
 * mean a different instant for an admin in Amsterdam than one in Tokyo.
 */
const STARTING_AT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * ISO-normalizes an admin-typed backfill start for the adapter's
 * `z.string().datetime()`.
 *
 * Strict on purpose: `Date.parse` rolls `2026-02-30` forward to March 2 instead
 * of failing, which would silently backfill from a date nobody chose.
 *
 * Empty is not an error — the field is optional — so it yields undefined, while
 * anything rejected yields null for the caller to turn into a toast.
 */
function normalizeStartingAt(raw: string): string | null | undefined {
  if (!raw) return undefined;

  const match = STARTING_AT.exec(raw);
  if (!match) return null;
  if (
    !isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  ) {
    return null;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * The Databricks Genie adapter config, or null when a required field is empty.
 *
 * Genie needs a real builder rather than the bare `{ adapter }` the other
 * reference pullers get, for two reasons the form cannot express on its own:
 * the token has to land under `credentials` so the server encrypts it, and
 * `spaceIds` is a comma-separated string in the form but an array in the
 * adapter's schema.
 */
function buildDatabricksGeniePullConfig(
  c: ComposerState,
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const workspaceUrl = (p.workspaceUrl ?? "").trim().replace(/\/+$/, "");
  const credentials = genieCredentialsFrom(p);
  const warehouseId = (p.warehouseId ?? "").trim();
  if (!workspaceUrl || !credentials) return null;

  return {
    adapter: "databricks_genie",
    workspaceUrl,
    // Empty means "every space the token can see", which is the setting most
    // workspaces want and the one that covers a new space automatically.
    spaceIds: (p.spaceIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    schedule:
      c.pullSchedule.trim() ||
      PULL_SCHEDULE_DEFAULTS.databricks_genie ||
      "*/15 * * * *",
    // Omitted rather than sent empty: the adapter reads "no warehouse named" as
    // "do not price these questions", and an empty string is a warehouse id it
    // would then ask the workspace about.
    ...(warehouseId ? { warehouseId } : {}),
    credentials,
  };
}

/**
 * The credential subtree for a Genie source, holding only what was actually
 * given: an empty string is not a credential, and sending one would make the
 * adapter prefer a token that does not exist. Null when neither way of
 * signing in is complete — half of the service principal pair is not one,
 * and accepting it would save a source that cannot run.
 */
function genieCredentialsFrom(
  p: Record<string, string>,
): Record<string, string> | null {
  const token = (p.credentialsToken ?? "").trim();
  const clientId = (p.credentialsClientId ?? "").trim();
  const clientSecret = (p.credentialsClientSecret ?? "").trim();

  const credentials: Record<string, string> = {};
  if (token) credentials.token = token;
  if (clientId && clientSecret) {
    credentials.clientId = clientId;
    credentials.clientSecret = clientSecret;
  }
  return Object.keys(credentials).length > 0 ? credentials : null;
}

/** How one parser-config field renders on the form it was handed to. */
export interface ParserFieldPresentation {
  isSecret: boolean;
  isMultiline: boolean;
  isRequired: boolean;
  hint: string | undefined;
  placeholder: string;
}

/**
 * What a parser-config field looks like on the form it is being rendered on.
 *
 * Only a secret behaves differently between create and edit, and it differs in
 * three ways at once: the hint, the required marker, and the placeholder.
 * Deciding all three from one predicate is what stops them drifting apart — a
 * field reading "leave blank to keep the current key" while still carrying a
 * required marker is a form contradicting itself, and each ternary spelled out
 * separately in the JSX is one edit away from that.
 *
 * `isSecretFieldKey` is the same predicate the masking and the storage routing
 * use; this must not become a third, drifting answer to "is this a secret".
 */
export function parserFieldPresentation({
  field,
  mode,
}: {
  field: FieldDef;
  mode: ParserConfigMode;
}): ParserFieldPresentation {
  const isSecret = isSecretFieldKey(field.key);
  // On edit the stored secret is never sent to the client, so the field opens
  // blank and stays blank unless the admin is deliberately replacing the key.
  const keepsStoredSecret = isSecret && mode === "edit";
  return {
    isSecret,
    isMultiline: field.key === "parserDsl" || field.key === "eventMappingDsl",
    isRequired: !!field.required && !keepsStoredSecret,
    // Create's hint tells them where to generate a key, which read on the edit
    // form would suggest they have to — and re-typing a key they do not have
    // to hand is how a working source gets archived and recreated instead.
    hint: keepsStoredSecret
      ? "Leave blank to keep the current key. Enter a new one only to replace it."
      : field.hint,
    placeholder: keepsStoredSecret ? "Unchanged" : field.placeholder,
  };
}

function ParserConfigField({
  field,
  values,
  onChange,
  mode = "create",
  readOnly = false,
}: {
  field: FieldDef;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  mode?: ParserConfigMode;
  readOnly?: boolean;
}) {
  const { isSecret, isMultiline, isRequired, hint, placeholder } =
    parserFieldPresentation({ field, mode });
  const value = values[field.key] ?? "";
  const handleChange = (next: string) =>
    onChange({ ...values, [field.key]: next });

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="medium">
        {field.label}
        {isRequired && (
          <Text as="span" color="red.500" marginLeft={1}>
            *
          </Text>
        )}
      </Text>
      {isMultiline ? (
        <Textarea
          size="sm"
          rows={6}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          fontFamily="mono"
          readOnly={readOnly}
        />
      ) : (
        <Input
          size="sm"
          type={isSecret ? "password" : "text"}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={readOnly}
        />
      )}
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
    </VStack>
  );
}

export function ParserConfigFields({
  sourceType,
  values,
  onChange,
  mode = "create",
  readOnlyKeys,
}: {
  sourceType: SourceType;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  mode?: ParserConfigMode;
  /**
   * Fields rendered but not editable. Used on the edit form for settings the
   * adapter can no longer act on — a backfill start once the cursor has moved
   * past it is accepted and then ignored, and an input that silently does
   * nothing is worse than no input at all.
   */
  readOnlyKeys?: readonly string[];
}) {
  const fields = PARSER_FIELDS[sourceType];
  const primaryFields = fields.filter((f) => !f.advanced);
  const advancedFields = fields.filter((f) => f.advanced);
  if (fields.length === 0) return null;
  const isReadOnly = (key: string) => readOnlyKeys?.includes(key) ?? false;
  return (
    <VStack align="stretch" gap={3}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Source-specific configuration
      </Text>
      {primaryFields.map((f) => (
        <ParserConfigField
          key={f.key}
          field={f}
          values={values}
          onChange={onChange}
          mode={mode}
          readOnly={isReadOnly(f.key)}
        />
      ))}
      {advancedFields.length > 0 && (
        // Unmounted while closed so the collapsed state genuinely holds
        // nothing the admin needs: create must work without ever opening it.
        <Collapsible.Root lazyMount unmountOnExit>
          <Collapsible.Trigger asChild>
            <Button size="xs" variant="ghost" color="fg.muted">
              <ChevronRight />
              Advanced
            </Button>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <VStack align="stretch" gap={3} paddingTop={2}>
              {advancedFields.map((f) => (
                <ParserConfigField
                  key={f.key}
                  field={f}
                  values={values}
                  onChange={onChange}
                  mode={mode}
                  readOnly={isReadOnly(f.key)}
                />
              ))}
            </VStack>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </VStack>
  );
}

/**
 * Form fields owned by a source type's ADAPTER config rather than by
 * parserConfig.
 *
 * The server merges pullConfig into parserConfig and lets parserConfig WIN on a
 * key clash, so a raw form value copied through here would silently override
 * the typed one its builder produced. For Genie that is not cosmetic:
 * `spaceIds` is a comma string in the form and an array in the adapter's
 * schema, so the string would win and the source would fail validation at pull
 * time — a broken source that looked fine when it was saved.
 */
const PULL_CONFIG_OWNED_FIELDS: Partial<Record<SourceType, readonly string[]>> =
  {
    // `report`/`bucketWidth` pass through unchanged, but `startingAt` is
    // normalized to an ISO instant by the builder — the raw form value
    // winning the merge would fail the adapter's `.datetime()` check at
    // pull time.
    anthropic_admin: ["report", "bucketWidth", "startingAt"],
    // `warehouseId` is here because the builder DROPS it when empty. Left to
    // the merge, the raw form value would persist `warehouseId: ""`, which the
    // adapter reads as a warehouse to go ask the workspace about.
    databricks_genie: ["workspaceUrl", "spaceIds", "warehouseId"],
  };

// Skip sentinel for a parserConfig entry that must not be persisted, kept
// distinct from a legitimately-falsy value an admin typed.
const DROP_PARSER_FIELD = Symbol("drop");

// The persisted value for one parserConfig entry, or DROP_PARSER_FIELD to omit
// it. Pulling the per-key decision out of the loop keeps `buildParserConfig`
// flat instead of a five-deep branch ladder.
function parserFieldValue(
  key: string,
  value: unknown,
): unknown | typeof DROP_PARSER_FIELD {
  if (value == null || value === "") return DROP_PARSER_FIELD;
  // Secrets travel in exactly one place: `pullConfig.credentials`, which is
  // the only subtree `encryptParserConfigCredentials` wraps before the row
  // reaches Postgres. A secret field copied to the top level of parserConfig
  // would be persisted as plaintext JSONB — so it never is. `isSecretFieldKey`
  // is the single source of truth for "is this a secret" (see its doc
  // comment) — this must not go back to an inline
  // `key.startsWith("credentials")` check here, or the storage-routing rule
  // can drift from the input-masking rule again.
  if (isSecretFieldKey(key)) return DROP_PARSER_FIELD;
  if (key === "pollEverySec") {
    const n = Number(value);
    return Number.isNaN(n) ? DROP_PARSER_FIELD : n;
  }
  return value;
}

export function buildParserConfig(c: ComposerState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const adapterOwned = new Set(PULL_CONFIG_OWNED_FIELDS[c.sourceType] ?? []);
  for (const [k, v] of Object.entries(c.parserConfig)) {
    if (adapterOwned.has(k)) continue;
    const resolved = parserFieldValue(k, v);
    if (resolved !== DROP_PARSER_FIELD) out[k] = resolved;
  }
  // Strip empty rows from the OTTL statement list - admins may leave a
  // blank trailing row from clicking "Add statement"; persisting it
  // would force the gateway parser to handle empty input as an error.
  const ottl = c.ottlStatements.filter((s) => s.trim().length > 0);
  if (ottl.length > 0) {
    out.ottlStatements = ottl;
  }
  return out;
}

/**
 * `buildParserConfig` read backwards: the stored config as the composer's flat
 * string form-state, for the edit form to open on.
 *
 * Only keys declared in `PARSER_FIELDS` are read, so nothing internal to the
 * row (`adapter`, `schedule`, the `_`-prefixed slots) leaks into a text input
 * an admin could then edit into something the adapter cannot parse.
 *
 * Secrets come back blank, always. `toDto` strips `credentials` before the row
 * reaches the client, so there is nothing to pre-fill even in principle — and
 * a blank field is what tells the builder to omit the key and leave the stored
 * secret alone. `isSecretFieldKey` is the same predicate the masking render
 * and the storage routing use; this must not become a third, drifting answer
 * to "is this a secret".
 */
export function seedComposerParserConfig({
  sourceType,
  storedParserConfig,
}: {
  sourceType: SourceType;
  storedParserConfig: Record<string, unknown>;
}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of PARSER_FIELDS[sourceType] ?? []) {
    if (isSecretFieldKey(field.key)) {
      values[field.key] = "";
      continue;
    }
    const stored = storedParserConfig[field.key];
    if (stored == null) continue;
    values[field.key] = String(stored);
  }
  return values;
}

/**
 * Pull source types whose adapter configuration the edit form can rebuild.
 *
 * The gate exists because "blank secret means keep the stored one" has to be
 * answered by each builder, and only Anthropic's answers it today. Databricks
 * accepts either a workspace token or a service-principal pair, so a blank
 * form there is ambiguous — it could mean "keep what is stored" or "switch
 * auth modes" — and guessing wrong locks an admin out of their own source.
 * The rest of the edit form (name, description, OTTL) is unaffected for every
 * type; only these get the adapter fields and the cadence control.
 *
 * See the follow-up issue noted in the PR for extending this to Databricks
 * Genie and the BYO `http_custom` shape.
 */
const EDITABLE_PULL_CONFIG_SOURCE_TYPES: readonly SourceType[] = [
  "anthropic_admin",
];

/**
 * The stored-credential envelope, recognised without importing the server's
 * `isEncryptedCredentials` — that module reaches for node `crypto` and has no
 * business in a browser bundle. The prefix is the whole check the client needs:
 * it is refusing to send something back, not trying to read it.
 */
function isEncryptedCredentialValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

/**
 * The parserConfig an edit should persist: the stored row, with the fields the
 * form owns replaced by what the form now holds.
 *
 * The subtlety is deletion. A builder omits an optional key when its field was
 * cleared, so merging the rebuilt config over the stored one with a plain
 * spread would leave the old value in place — an admin clearing a bucket width
 * would watch the save succeed and the setting stay. Every key the form owns is
 * therefore dropped first, and the rebuilt config reinstates only the ones that
 * still have a value.
 *
 * Keys the form does NOT own are carried through untouched, which is what keeps
 * an edit from dropping `workspaceId`, `sharedSecretLastFour` and the rest of
 * the adapter's own bookkeeping.
 */
export function buildEditedParserConfig({
  sourceType,
  storedParserConfig,
  rebuiltPullConfig,
  ottlStatements,
}: {
  sourceType: SourceType;
  storedParserConfig: Record<string, unknown>;
  /** null for a push-mode source, whose adapter config the form cannot edit. */
  rebuiltPullConfig: Record<string, unknown> | null;
  ottlStatements: string[];
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...storedParserConfig };

  const cleanedOttl = ottlStatements.filter((s) => s.trim().length > 0);
  if (cleanedOttl.length > 0) {
    next.ottlStatements = cleanedOttl;
  } else {
    delete next.ottlStatements;
  }

  if (rebuiltPullConfig) {
    for (const field of PARSER_FIELDS[sourceType] ?? []) {
      delete next[field.key];
    }
    for (const key of PULL_CONFIG_OWNED_FIELDS[sourceType] ?? []) {
      delete next[key];
    }
    Object.assign(next, rebuiltPullConfig);
  }

  // Never hand back a stored envelope. `toDto` strips it, so this should be
  // unreachable — but the seed-and-respread path above only stays safe for as
  // long as that holds, and the server answers an envelope with a hard
  // ValidationError rather than a no-op.
  if (isEncryptedCredentialValue(next.credentials)) {
    delete next.credentials;
  }

  return next;
}

/**
 * Whether the edit form may rebuild this source type's adapter configuration.
 *
 * Both halves matter: the type has to actually pull, so there is a pull config
 * to rebuild at all, and it has to be on the allowlist, so the form knows what
 * a blank secret means for it. The predicate narrows, so a caller that passes
 * the DTO's bare `sourceType` string gets a `SourceType` inside the guard
 * without a second cast.
 */
export function isEditablePullSource(
  sourceType: SourceType | undefined,
): sourceType is SourceType {
  return (
    !!sourceType &&
    !!PULL_ADAPTER_FOR_SOURCE[sourceType] &&
    EDITABLE_PULL_CONFIG_SOURCE_TYPES.includes(sourceType)
  );
}

/** What the edit drawer sends to `ingestionSources.update`. */
export interface EditSubmission {
  organizationId: string;
  id: string;
  name: string;
  description: string | null;
  parserConfig: Record<string, unknown>;
  pullSchedule?: string | null;
}

/**
 * The edit form's submission, assembled from the form state and the row it
 * opened on. `null` means the form is not in a saveable state and the caller
 * does nothing: either the name is empty, or a pull field is one the adapter
 * cannot parse — in which case `resolvePullConfig` has already toasted which.
 *
 * Module-level rather than a closure inside the drawer because this is where
 * the decisions that matter live — whether the pull config is rebuilt at all,
 * and whether `pullSchedule` rides along — and no test renders the drawer.
 * Leaving them inline made the whole edit path reachable only through a React
 * surface nothing exercises.
 */
export function buildEditSubmission({
  organizationId,
  source,
  name,
  description,
  parserConfig,
  ottlStatements,
  pullSchedule,
}: {
  organizationId: string;
  source: { id: string; sourceType: string; parserConfig: unknown };
  name: string;
  description: string;
  parserConfig: Record<string, string>;
  ottlStatements: string[];
  pullSchedule: string;
}): EditSubmission | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;

  const sourceType = source.sourceType as SourceType;
  const isPullMode = isEditablePullSource(sourceType);

  let rebuiltPullConfig: Record<string, unknown> | null = null;
  if (isPullMode) {
    // Reuses the create path's dispatcher, and with it the toast that names
    // which field is wrong — a second builder here is how the two forms would
    // drift into disagreeing about what a valid bucket width is.
    const resolved = resolvePullConfig(
      {
        sourceType,
        name: trimmedName,
        description: description.trim(),
        parserConfig,
        ottlStatements,
        pullSchedule,
      },
      { requireCredentials: false },
    );
    // Refusing here is the whole point of the builder: nothing validates this
    // server-side, so a bad value saved now surfaces as a failing pull an hour
    // later.
    if (!resolved?.pullConfig) return null;
    rebuiltPullConfig = resolved.pullConfig;
  }

  return {
    organizationId,
    id: source.id,
    name: trimmedName,
    description: description.trim() || null,
    parserConfig: buildEditedParserConfig({
      sourceType,
      storedParserConfig:
        (source.parserConfig as Record<string, unknown>) ?? {},
      rebuiltPullConfig,
      ottlStatements,
    }),
    // Only sent for a type whose cadence the form actually renders. Including
    // it for a push source would send `null` for a column no one edited.
    ...(isPullMode ? { pullSchedule: pullSchedule.trim() || null } : {}),
  };
}

/**
 * Claude Code's monitoring-usage doc requires CLAUDE_CODE_ENABLE_TELEMETRY=1
 * plus the standard OTEL_*_EXPORTER env vars. We recommend
 * OTEL_TRACES_EXPORTER=otlp so spans claude-code instruments propagate to
 * LangWatch and logs/metrics emitted inside those spans get correlated; the
 * session.id resource attribute is then mapped to gen_ai.conversation.id by
 * the OpenInference extractor so the UI groups the session as one thread.
 * Pre-build the shell export block so admins paste once instead of stitching
 * seven lines off the docs page.
 *
 * Plus the four content-unlock knobs (USER_PROMPTS + TOOL_DETAILS +
 * TOOL_CONTENT + RAW_API_BODIES). Without these, the OTel wire is
 * metadata-only, tokens, cost, durations and tool sizes-in-bytes, and user
 * prompt text, assistant response text and tool I/O content are silently
 * absent. With them on, langwatch.input + langwatch.output lift verbatim from
 * claude's api_request + api_response_body events. Payload risk is bounded by
 * claude's 60KB inline cap plus the langwatch receiver content cap.
 */
function buildClaudeCodeEnvBlock({
  details,
  otlpUrl,
}: {
  details: SecretDetails;
  otlpUrl: string;
}): string {
  return [
    `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
    `export OTEL_TRACES_EXPORTER=otlp`,
    `export OTEL_LOGS_EXPORTER=otlp`,
    `export OTEL_METRICS_EXPORTER=otlp`,
    `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
    `export OTEL_LOG_USER_PROMPTS=1`,
    `export OTEL_LOG_TOOL_DETAILS=1`,
    `export OTEL_LOG_TOOL_CONTENT=1`,
    `export OTEL_LOG_RAW_API_BODIES=1`,
    `export OTEL_EXPORTER_OTLP_ENDPOINT="${otlpUrl}"`,
    `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${details.secret}"`,
  ].join("\n");
}

/**
 * A copy-paste curl that exercises the full happy path: the body parses, the
 * attribute parser sees the canonical gen_ai.* + user.email keys, and the KPI
 * strip moves on the first event. The timestamp is fresh at modal open so the
 * test event lands inside the 24h health window even if the admin waits a
 * little before pasting. Null for source types with no push endpoint.
 */
function buildTestCurl({
  details,
  otlpUrl,
  webhookUrl,
  usesPushUrl,
  usesWebhookUrl,
}: {
  details: SecretDetails;
  otlpUrl: string;
  webhookUrl: string;
  usesPushUrl: boolean;
  usesWebhookUrl: boolean;
}): string | null {
  if (usesPushUrl) {
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
                  startTimeUnixNano: `${Date.now()}000000`,
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
                    {
                      key: "user.email",
                      value: { stringValue: "you@your.org" },
                    },
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
}

/** The bearer token itself, shown once. */
function IngestSecretPanel({
  secret,
  copied,
  onCopy,
}: {
  secret: string;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  return (
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
          {secret}
        </Code>
        <Button size="sm" variant="outline" onClick={() => onCopy(secret)}>
          <Copy size={14} /> {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
    </VStack>
  );
}

/** Where a webhook-mode source posts its events. */
function WebhookEndpointPanel({
  webhookUrl,
  onCopy,
}: {
  webhookUrl: string;
  onCopy: (value: string) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Webhook URL (paste into upstream webhook config)
      </Text>
      <HStack gap={2}>
        <Code flex={1} padding={2} fontSize="xs">
          {webhookUrl}
        </Code>
        <Button size="sm" variant="outline" onClick={() => onCopy(webhookUrl)}>
          <Copy size={14} />
        </Button>
      </HStack>
    </VStack>
  );
}

/** The one-shot warning, and how long the old secret keeps working. */
function SecretGraceNotice() {
  return (
    <Box
      borderWidth="1px"
      borderColor="amber.300"
      backgroundColor="amber.50"
      padding={3}
      borderRadius="sm"
    >
      <Text fontSize="xs" color="amber.900">
        <strong>Important:</strong> the secret above will not be shown again. We
        retained the prior secret&apos;s hash for a 24h grace window if
        you&apos;re rotating, so you have time to roll the new value through
        every upstream client.
      </Text>
    </Box>
  );
}

/** Where a push-mode source sends its OTLP, and which endpoint is which. */
function OtlpEndpointPanel({
  otlpUrl,
  onCopy,
}: {
  otlpUrl: string;
  onCopy: (value: string) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        OTLP ingestion endpoint (paste into upstream exporter)
      </Text>
      <HStack gap={2}>
        <Code flex={1} padding={2} fontSize="xs">
          {otlpUrl}
        </Code>
        <Button size="sm" variant="outline" onClick={() => onCopy(otlpUrl)}>
          <Copy size={14} />
        </Button>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        Spans push into the LangWatch trace store with this source&apos;s origin
        tag and become viewable in the trace viewer. If you are sending agent
        traces from your own LangWatch SDK, use{" "}
        <Code fontSize="xs">/api/otel/v1/traces</Code> with your project API key
        - different auth, same trace store. See{" "}
        <Link
          href="https://docs.langwatch.ai/observability/trace-vs-activity-ingestion"
          color="blue.600"
        >
          Choosing the right OTel endpoint
        </Link>
        .
      </Text>
    </VStack>
  );
}

/** The paste-once shell block a Claude Code source is configured with. */
function ClaudeCodeEnvBlockPanel({
  envBlock,
  onCopy,
}: {
  envBlock: string;
  onCopy: (value: string) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <HStack justify="space-between" alignItems="center">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Claude Code shell env block
        </Text>
        <Button size="xs" variant="outline" onClick={() => onCopy(envBlock)}>
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
        {envBlock}
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
        itself off the base endpoint. To attribute spend to a specific team or
        department, also export{" "}
        <Code fontSize="xs" backgroundColor="transparent">
          OTEL_RESOURCE_ATTRIBUTES=team.id=…,department=…
        </Code>{" "}
        - those land as resource attributes and slot into /governance&apos;s
        spendByTeam without further config.
      </Text>
    </VStack>
  );
}

/** The smoke-test curl, and how to read what it returns. */
function TestCurlPanel({
  curl,
  copied,
  onCopy,
}: {
  curl: string;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Test it now - paste this into a terminal
      </Text>
      <Box position="relative">
        <Code
          display="block"
          padding={3}
          fontSize="xs"
          whiteSpace="pre"
          overflowX="auto"
        >
          {curl}
        </Code>
        <Button
          size="xs"
          variant="outline"
          position="absolute"
          top={2}
          right={2}
          onClick={() => onCopy(curl)}
        >
          <Copy size={12} /> {copied ? "Copied" : "Copy"}
        </Button>
      </Box>
      <Text fontSize="xs" color="fg.muted">
        Returns HTTP 202 with <Code fontSize="xs">events: 1</Code> on success.
        If you get <Code fontSize="xs">events: 0</Code> with a hint, the body
        shape didn&apos;t parse - check the docs.
      </Text>
    </VStack>
  );
}

/** The endpoints and source-type flags a secret reveal is rendered against. */
function secretModalTargets(details: SecretDetails | null) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://langwatch.invalid";
  return {
    otlpUrl: details ? `${baseUrl}/api/ingest/otel/${details.sourceId}` : "",
    webhookUrl: details
      ? `${baseUrl}/api/ingest/webhook/${details.sourceId}`
      : "",
    usesPushUrl:
      details?.sourceType === "otel_generic" ||
      details?.sourceType === "claude_cowork" ||
      details?.sourceType === "claude_code",
    usesWebhookUrl: details?.sourceType === "workato",
    isClaudeCode: details?.sourceType === "claude_code",
  };
}

function SecretModal({
  details,
  onClose,
}: {
  details: SecretDetails | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { otlpUrl, webhookUrl, usesPushUrl, usesWebhookUrl, isClaudeCode } =
    secretModalTargets(details);

  const claudeCodeEnvBlock = useMemo(
    () =>
      isClaudeCode && details
        ? buildClaudeCodeEnvBlock({ details, otlpUrl })
        : "",
    [isClaudeCode, details, otlpUrl],
  );

  const testCurl = useMemo(
    () =>
      details
        ? buildTestCurl({
            details,
            otlpUrl,
            webhookUrl,
            usesPushUrl,
            usesWebhookUrl,
          })
        : null,
    [details, otlpUrl, webhookUrl, usesPushUrl, usesWebhookUrl],
  );

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
            <IngestSecretPanel
              secret={details.secret}
              copied={copied}
              onCopy={copy}
            />
            {usesPushUrl && (
              <OtlpEndpointPanel otlpUrl={otlpUrl} onCopy={copy} />
            )}
            {usesWebhookUrl && (
              <WebhookEndpointPanel webhookUrl={webhookUrl} onCopy={copy} />
            )}
            {isClaudeCode && (
              <ClaudeCodeEnvBlockPanel
                envBlock={claudeCodeEnvBlock}
                onCopy={copy}
              />
            )}
            {testCurl && (
              <TestCurlPanel curl={testCurl} copied={copied} onCopy={copy} />
            )}
            <SecretGraceNotice />
          </VStack>
        </DialogBody>
        <DialogFooter>
          <Link href={`/governance/inventory/${details.sourceId}`}>
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
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(InventoryPage),
);
