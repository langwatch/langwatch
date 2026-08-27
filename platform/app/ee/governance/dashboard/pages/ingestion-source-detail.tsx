// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  Code,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowLeft,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  KeyRound,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import numeral from "numeral";
import { type ReactNode, useCallback, useState } from "react";

import { EnterpriseLockedSurface } from "~/components/enterprise/EnterpriseLockedSurface";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { NotFoundScene } from "~/components/NotFoundScene";
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
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import {
  HandledErrorAlert,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import type { SourceType } from "../components/ingestionSourceCatalog";
import { needsIngestSecret } from "../components/ingestionSourceCatalog";
import { SourceEventsTable } from "../components/SourceEventsTable";
import {
  type SourceEventsPager,
  useSourceEventsPager,
} from "../components/useSourceEventsPager";
import type { PageRequest } from "../logic/eventsPager";
import { useDestinationContext } from "./ingestionSourceForms";
import { SourceEditDrawer } from "./inventory";

/**
 * Per-source detail page - health metrics + a cursor-walked table of every
 * event the source ever ingested, raw vs normalised on expand. Wired to
 * api.activityMonitor.eventsForSource + sourceHealthMetrics.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (scenario "Per-source detail page shows health" and rule "The
 *       events table pages through everything the source ever ingested")
 */

type Source = RouterOutputs["ingestionSources"]["get"];
type EventRow = RouterOutputs["activityMonitor"]["eventsForSource"][number];
type SourceHealthMetrics =
  RouterOutputs["activityMonitor"]["sourceHealthMetrics"];

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

/**
 * Whether a failed load actually means "no such source".
 *
 * One channel: `ingestionSources.get` raises `IngestionSourceNotFoundError`,
 * and a `NotFoundError` carries `httpStatus` 404 whatever tRPC code wrapped
 * it. The second branch that sniffed the tRPC envelope for a bare
 * `NOT_FOUND` is gone with the bare throw it existed to cover. Anything else
 * is a load failure, not a deletion: a permission denial, a 500 or a dropped
 * connection used to land on the not-found scene too, so an admin whose
 * source was very much alive was told it had been deleted.
 */
function isNotFoundError(error: unknown): boolean {
  return readHandledError(error)?.httpStatus === 404;
}

const fmtRelative = (iso: string | null): string =>
  iso ? (formatTimeAgo(new Date(iso).getTime()) ?? "-") : "-";

/** Back link, name, status, and the two manage-only controls. */
function SourceDetailHeader({
  source,
  canManage,
  isRotating,
  isArchiving,
  onRotate,
  onArchive,
  onEdit,
}: {
  source: Source;
  canManage: boolean;
  isRotating: boolean;
  isArchiving: boolean;
  onRotate: () => void;
  onArchive: () => void;
  onEdit: () => void;
}) {
  const status =
    STATUS_META[source.status] ?? STATUS_META.awaiting_first_event!;
  const StatusIcon = status.icon;
  return (
    <HStack alignItems="end">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Link
            href="/governance/inventory?tab=sources"
            color="blue.600"
            fontSize="xs"
          >
            <HStack gap={1}>
              <ArrowLeft size={12} />
              <Text>All sources</Text>
            </HStack>
          </Link>
        </HStack>
        <HStack gap={2}>
          <Heading size="md">{source.name}</Heading>
          <Badge size="sm" variant="surface">
            {source.sourceType}
          </Badge>
          <HStack gap={1}>
            <Box color={status.color} display="flex">
              <StatusIcon size={14} />
            </Box>
            <Text fontSize="sm" color="fg.muted">
              {status.label}
            </Text>
          </HStack>
        </HStack>
        {source.description && (
          <Text fontSize="sm" color="fg.muted">
            {source.description}
          </Text>
        )}
      </VStack>
      <Spacer />
      {/* Editing, rotating a secret and archiving are all
          `ingestionSources:manage`. */}
      {canManage && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            title="Edit this source's configuration"
          >
            <Pencil size={14} /> Edit
          </Button>
          {needsIngestSecret({
            sourceType: source.sourceType as SourceType,
          }) && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRotate}
              loading={isRotating}
              title="Mint a new ingestSecret (24h grace on the old one)"
            >
              <RotateCw size={14} /> Rotate secret
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            colorPalette="red"
            onClick={() => {
              if (
                !confirm(
                  `Archive "${source.name}"? Historical events stay readable.`,
                )
              )
                return;
              onArchive();
            }}
            loading={isArchiving}
          >
            <Trash2 size={14} /> Archive
          </Button>
        </>
      )}
    </HStack>
  );
}

/**
 * The four event-count cards. They read `health?.events24h ?? 0`, so a failed
 * health query would render "0 events", indistinguishable from a silent
 * source, and the first thing an admin does about a silent source is go
 * rebuild an integration that was never broken. The alert takes their place.
 */
function SourceHealthCards({
  health,
  error,
  isLoading,
}: {
  health: SourceHealthMetrics | undefined;
  error: unknown;
  isLoading: boolean;
}) {
  if (error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load health metrics for this source"
      />
    );
  }
  return (
    <SimpleGrid columns={{ base: 2, md: 4 }} gap={4}>
      <MetricCard
        title="Events 24h"
        value={numeral(health?.events24h ?? 0).format("0,0")}
        isLoading={isLoading}
      />
      <MetricCard
        title="Events 7d"
        value={numeral(health?.events7d ?? 0).format("0,0")}
        isLoading={isLoading}
      />
      <MetricCard
        title="Events 30d"
        value={numeral(health?.events30d ?? 0).format("0,0")}
        isLoading={isLoading}
      />
      <MetricCard
        title="Last event"
        value={fmtRelative(health?.lastSuccessIso ?? null)}
        isLoading={isLoading}
      />
    </SimpleGrid>
  );
}

/**
 * Health counts, the stale-timestamp callout and the event feed. All three
 * come from the activity monitor, which has a grant of its own, so naming
 * that grant here keeps the source's own configuration readable to whoever
 * holds only `ingestionSources:view`.
 */
function SourceActivityPanels({
  source,
  canReadActivity,
  healthQuery,
  eventsPager,
}: {
  source: Source;
  canReadActivity: boolean;
  healthQuery: {
    data: SourceHealthMetrics | undefined;
    error: unknown;
    isLoading: boolean;
  };
  eventsPager: SourceEventsPager<EventRow>;
}) {
  if (!canReadActivity) {
    return (
      <PermissionRequiredNotice
        permission="activityMonitor:view"
        detail="Event counts and the recent-event feed stay hidden until then."
      />
    );
  }
  const health = healthQuery.data;
  return (
    <>
      <SourceHealthCards
        health={health}
        error={healthQuery.error}
        isLoading={healthQuery.isLoading}
      />
      <StaleTimestampCallout
        health={health ?? null}
        eventsCount={eventsPager.loadedCount}
      />
      {/* `EmptyEventsHint` walks an admin through setting up an integration.
          The table only shows it once a load SUCCEEDED and came back empty —
          showing it on a failed load sends someone debugging a live source
          off to re-install something that is already working. */}
      <SourceEventsTable
        pager={eventsPager}
        emptyState={<EmptyEventsHint source={source} />}
      />
    </>
  );
}

/**
 * What a viewer without `ingestionSources:view` sees. No enterprise upsell
 * here: the grant, not the plan, is what is missing.
 */
function SourceAccessDenied({ pageTitle }: { pageTitle: string }) {
  return (
    <GovernanceLayout pageTitle={pageTitle}>
      <PermissionRequiredNotice
        permission="ingestionSources:view"
        detail="This source's configuration and health stay hidden until then."
      />
    </GovernanceLayout>
  );
}

/** The page chrome every state of this page renders inside. */
function SourceDetailShell({
  pageTitle,
  children,
}: {
  pageTitle: string;
  children: ReactNode;
}) {
  return (
    <GovernanceLayout pageTitle={pageTitle}>
      <EnterpriseLockedSurface
        featureName="Ingestion Source detail"
        description="Source-level health metrics and event drill-downs are part of the Enterprise plan."
      >
        {children}
      </EnterpriseLockedSurface>
    </GovernanceLayout>
  );
}

/**
 * The three writes this page offers. All are `ingestionSources:manage`; a
 * rotate reveals the new secret once, an archive sends the admin back to the
 * list, and an edit reopens the same drawer the source list uses.
 */
function useSourceDetailMutations({
  orgId,
  sourceId,
  onSecretRevealed,
  onEdited,
}: {
  orgId: string;
  sourceId: string | undefined;
  onSecretRevealed: (details: { secret: string; sourceName: string }) => void;
  onEdited: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const update = api.ingestionSources.update.useMutation({
    onSuccess: () => {
      void utils.ingestionSources.get.invalidate({
        organizationId: orgId,
        id: sourceId,
      });
      toaster.create({ title: "Source updated", type: "success" });
      onEdited();
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't update the source",
      }),
  });
  const rotate = api.ingestionSources.rotateSecret.useMutation({
    onSuccess: (data) => {
      void utils.ingestionSources.get.invalidate({
        organizationId: orgId,
        id: sourceId,
      });
      onSecretRevealed({
        secret: data.ingestSecret,
        sourceName: data.source.name,
      });
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't rotate the secret" }),
  });
  const archive = api.ingestionSources.archive.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Source archived", type: "success" });
      void router.push("/governance/inventory?tab=sources");
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't archive the source",
      }),
  });
  return { rotate, archive, update };
}

/**
 * Everything the page needs: the source it addresses, what the viewer may do,
 * the three queries behind it and the three mutations that act on it. State and
 * callbacks only, the component owns the markup.
 */
function useIngestionSourceDetailPage() {
  const router = useRouter();
  const sourceId = router.query.id as string | undefined;
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  // Same derivation the inventory page uses, so the drawer offers the same
  // destinations whichever surface opened it.
  const destinationCtx = useDestinationContext(organization);
  const canRead = hasAnyPermission("ingestionSources:view");
  const canReadActivity = hasAnyPermission("activityMonitor:view");

  const sourceQuery = api.ingestionSources.get.useQuery(
    { organizationId: orgId, id: sourceId ?? "" },
    { enabled: !!orgId && !!sourceId && canRead, refetchOnWindowFocus: false },
  );
  const healthQuery = api.activityMonitor.sourceHealthMetrics.useQuery(
    { organizationId: orgId, sourceId: sourceId ?? "" },
    {
      enabled: !!orgId && !!sourceId && canReadActivity,
      refetchOnWindowFocus: false,
    },
  );
  // The events table walks the timestamp cursor itself (see
  // logic/eventsPager.ts), so it fetches imperatively through the utils
  // client instead of useQuery: pages once loaded are kept and never
  // refetched, which pins the first page's time anchor.
  const utils = api.useUtils();
  const fetchEventsPage = useCallback(
    (request: PageRequest) =>
      utils.activityMonitor.eventsForSource.fetch({
        organizationId: orgId,
        sourceId: sourceId ?? "",
        limit: request.limit,
        ...(request.beforeIso ? { beforeIso: request.beforeIso } : {}),
      }),
    [utils, orgId, sourceId],
  );
  const eventsPager = useSourceEventsPager<EventRow>({
    enabled: !!orgId && !!sourceId && canReadActivity,
    fetchPage: fetchEventsPage,
  });
  const [secretReveal, setSecretReveal] = useState<{
    secret: string;
    sourceName: string;
  } | null>(null);

  const [isEditing, setIsEditing] = useState(false);

  const {
    rotate: rotateMutation,
    archive: archiveMutation,
    update: updateMutation,
  } = useSourceDetailMutations({
    orgId,
    sourceId,
    onSecretRevealed: setSecretReveal,
    onEdited: () => setIsEditing(false),
  });

  return {
    sourceId,
    orgId,
    destinationCtx,
    canRead,
    canManage: hasAnyPermission("ingestionSources:manage"),
    canReadActivity,
    sourceQuery,
    healthQuery,
    eventsPager,
    secretReveal,
    setSecretReveal,
    rotateMutation,
    archiveMutation,
    updateMutation,
    isEditing,
    setIsEditing,
  };
}

function IngestionSourceDetailPage() {
  const {
    sourceId,
    orgId,
    destinationCtx,
    canRead,
    canManage,
    canReadActivity,
    sourceQuery,
    healthQuery,
    eventsPager,
    secretReveal,
    setSecretReveal,
    rotateMutation,
    archiveMutation,
    updateMutation,
    isEditing,
    setIsEditing,
  } = useIngestionSourceDetailPage();

  if (!sourceId) {
    return <NotFoundScene />;
  }

  const source = sourceQuery.data;
  const pageTitle = source?.name
    ? `${source.name} · Ingestion Source · LangWatch`
    : "Ingestion Source · LangWatch";

  if (!canRead) {
    return <SourceAccessDenied pageTitle={pageTitle} />;
  }

  // "This source doesn't exist" is a claim, and only a genuine 404 earns it.
  if (isNotFoundError(sourceQuery.error)) {
    return <NotFoundScene />;
  }
  if (sourceQuery.error) {
    return (
      <SourceDetailShell pageTitle={pageTitle}>
        <HandledErrorAlert
          error={sourceQuery.error}
          fallbackTitle="Couldn't load this ingestion source"
        />
      </SourceDetailShell>
    );
  }

  if (!source) {
    return (
      <SourceDetailShell pageTitle={pageTitle}>
        <Spinner size="sm" />
      </SourceDetailShell>
    );
  }

  return (
    <LoadedSourceDetail
      pageTitle={pageTitle}
      source={source}
      orgId={orgId}
      destinationCtx={destinationCtx}
      canManage={canManage}
      canReadActivity={canReadActivity}
      healthQuery={healthQuery}
      eventsPager={eventsPager}
      secretReveal={secretReveal}
      setSecretReveal={setSecretReveal}
      rotateMutation={rotateMutation}
      archiveMutation={archiveMutation}
      updateMutation={updateMutation}
      isEditing={isEditing}
      setIsEditing={setIsEditing}
    />
  );
}

/**
 * The page once the source has actually loaded. Split from the function above
 * so that one reads as the scene chooser it is — not found, denied, errored,
 * loading, loaded — without the whole loaded layout inlined at the bottom of
 * the same chain.
 */
function LoadedSourceDetail({
  pageTitle,
  source,
  orgId,
  destinationCtx,
  canManage,
  canReadActivity,
  healthQuery,
  eventsPager,
  secretReveal,
  setSecretReveal,
  rotateMutation,
  archiveMutation,
  updateMutation,
  isEditing,
  setIsEditing,
}: {
  pageTitle: string;
  source: Source;
  orgId: string;
} & Pick<
  ReturnType<typeof useIngestionSourceDetailPage>,
  | "destinationCtx"
  | "canManage"
  | "canReadActivity"
  | "healthQuery"
  | "eventsPager"
  | "secretReveal"
  | "setSecretReveal"
  | "rotateMutation"
  | "archiveMutation"
  | "updateMutation"
  | "isEditing"
  | "setIsEditing"
>) {
  return (
    <SourceDetailShell pageTitle={pageTitle}>
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <SourceDetailHeader
          source={source}
          canManage={canManage}
          isRotating={rotateMutation.isPending}
          isArchiving={archiveMutation.isPending}
          onRotate={() =>
            rotateMutation.mutate({ organizationId: orgId, id: source.id })
          }
          onArchive={() =>
            archiveMutation.mutate({ organizationId: orgId, id: source.id })
          }
          onEdit={() => setIsEditing(true)}
        />

        {/* The same drawer the source list opens, so the two surfaces cannot
            drift into offering different edits of the same row. */}
        <SourceEditDrawer
          organizationId={orgId}
          destinationCtx={destinationCtx}
          source={isEditing ? source : null}
          onClose={() => setIsEditing(false)}
          onSubmit={(input) => updateMutation.mutate(input)}
          isPending={updateMutation.isPending}
        />

        <SourceActivityPanels
          source={source}
          canReadActivity={canReadActivity}
          healthQuery={healthQuery}
          eventsPager={eventsPager}
        />
      </VStack>

      <SecretRevealModal
        details={secretReveal}
        sourceId={source.id}
        sourceType={source.sourceType}
        onClose={() => setSecretReveal(null)}
      />
    </SourceDetailShell>
  );
}

function StaleTimestampCallout({
  health,
  eventsCount,
}: {
  health: SourceHealthMetrics | null;
  eventsCount: number;
}) {
  // F-OTEL-2 frontend leg (Sergey diagnosis): if health metrics show 0
  // events across 24h/7d/30d but the events list has rows, the user
  // most likely sent test events with stale `startTimeUnixNano`. CH
  // health queries filter by EventTimestamp, the events list does not
  // - they appear contradictory. Surface a callout that names the
  // diagnosis + the fix (use Date.now() at the moment you fire the
  // event).
  if (!health) return null;
  const all30dZero =
    (health.events24h ?? 0) === 0 &&
    (health.events7d ?? 0) === 0 &&
    (health.events30d ?? 0) === 0;
  if (!all30dZero || eventsCount === 0) return null;
  return (
    <Box
      borderWidth="1px"
      borderColor="amber.300"
      backgroundColor="amber.50"
      padding={3}
      borderRadius="md"
    >
      <Text fontSize="sm" color="amber.900">
        <strong>Heads up:</strong> the events table below has loaded{" "}
        {eventsCount} event
        {eventsCount === 1 ? "" : "s"}, but the rolling
        24h&nbsp;/&nbsp;7d&nbsp;/&nbsp;30d health windows are all zero. Your
        events likely have a stale <Code fontSize="xs">startTimeUnixNano</Code>{" "}
        (timestamps before today). When firing test events, set{" "}
        <Code fontSize="xs">startTimeUnixNano</Code> to{" "}
        <Code fontSize="xs">String(Date.now() * 1_000_000)</Code> so the event
        lands inside the rolling window. The secret-reveal modal&apos;s
        &quot;Test it now&quot; curl already does this for you.
      </Text>
    </Box>
  );
}

function EmptyEventsHint({ source }: { source: Source }) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://langwatch.invalid";
  const isOtel =
    source.sourceType === "otel_generic" ||
    source.sourceType === "claude_cowork";
  const isWebhook = source.sourceType === "workato";
  const mode = isOtel ? "otel" : isWebhook ? "webhook" : "<mode>";
  const endpoint = `${baseUrl}/api/ingest/${mode}/${source.id}`;
  return (
    <VStack align="stretch" gap={3}>
      <Text fontSize="sm" color="fg.muted">
        No traces from this source yet. Push an OTLP body to{" "}
        <Code fontSize="xs">{endpoint}</Code> with the source&apos;s bearer
        secret to start populating.
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Spans land in the LangWatch trace store with this source&apos;s origin
        tag, viewable in the trace viewer. If you are sending agent traces from
        your own LangWatch SDK, use{" "}
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
      <Text fontSize="xs" color="fg.muted">
        Lost the secret? Click <strong>Rotate secret</strong> above - the new
        bearer is shown once with a copy-paste curl example, and the prior
        secret stays valid for 24h while you roll the new value through every
        upstream client.
      </Text>
      {isOtel && (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={3}
        >
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
            Minimum viable OTLP body shape (camelCase keys):
          </Text>
          <Code
            display="block"
            fontSize="xs"
            whiteSpace="pre"
            overflowX="auto"
            padding={2}
          >{`{
  "resource_spans": [{
    "scope_spans": [{
      "spans": [{
        "name": "chat.completion",
        "startTimeUnixNano": "<NOW_NS>",
        "attributes": [
          { "key": "gen_ai.request.model",       "value": { "stringValue": "claude-sonnet-4" } },
          { "key": "gen_ai.usage.input_tokens",  "value": { "intValue": 120 } },
          { "key": "gen_ai.usage.output_tokens", "value": { "intValue": 480 } },
          { "key": "gen_ai.usage.cost_usd",      "value": { "doubleValue": 0.025 } },
          { "key": "user.email",                 "value": { "stringValue": "you@your.org" } }
        ]
      }]
    }]
  }]
}`}</Code>
          <Text fontSize="xs" color="fg.muted" mt={2}>
            Returns HTTP 202 with <Code fontSize="xs">events: 1</Code> on
            success. If you get <Code fontSize="xs">events: 0</Code> with a
            hint, the body shape didn&apos;t parse. See the{" "}
            <Link
              href="https://docs.langwatch.ai/ai-gateway/governance/ingestion-sources/otel-generic"
              color="blue.600"
            >
              otel-generic docs
            </Link>{" "}
            for the full attribute reference.
          </Text>
        </Box>
      )}
    </VStack>
  );
}

function MetricCard({
  title,
  value,
  isLoading,
}: {
  title: string;
  value: string;
  isLoading?: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {title}
      </Text>
      {isLoading ? (
        <Spinner size="xs" marginTop={2} />
      ) : (
        <Heading as="span" size="md" marginTop={1} display="block">
          {value}
        </Heading>
      )}
    </Box>
  );
}

function SecretRevealModal({
  details,
  sourceId,
  sourceType,
  onClose,
}: {
  details: { secret: string; sourceName: string } | null;
  sourceId: string;
  sourceType: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!details) return null;
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://langwatch.invalid";
  const otlpUrl = `${baseUrl}/api/ingest/otel/${sourceId}`;
  const webhookUrl = `${baseUrl}/api/ingest/webhook/${sourceId}`;
  const usesPushUrl =
    sourceType === "otel_generic" ||
    sourceType === "claude_cowork" ||
    sourceType === "claude_code";
  const usesWebhookUrl = sourceType === "workato" || sourceType === "s3_custom";
  const isClaudeCode = sourceType === "claude_code";

  // Claude Code's monitoring-usage doc requires CLAUDE_CODE_ENABLE_TELEMETRY=1
  // plus the standard OTEL_*_EXPORTER env vars before any signals are emitted.
  // We also recommend OTEL_TRACES_EXPORTER=otlp so any spans Claude Code does
  // instrument propagate to LangWatch and any logs/metrics emitted INSIDE a
  // span get correlated. Standalone records still arrive without trace context
  // (logs emitted outside spans always will, per OTLP proto v1.0.0 where
  // trace_id/span_id are optional on LogRecord), but the receiver synthesizes
  // a stable trace id from service.name + service.instance.id so each session
  // surfaces as one named trace in the listing. Pre-build the shell export
  // block so admins paste once instead of stitching seven lines off the docs
  // page.
  // Plus the four content-unlock knobs (USER_PROMPTS + TOOL_DETAILS +
  // TOOL_CONTENT + RAW_API_BODIES). Without these, the OTel wire is
  // metadata-only: tokens, cost, durations, tool sizes-in-bytes - but
  // no user prompt text, no assistant response text, no tool I/O
  // content. With them on, langwatch.input + langwatch.output lift
  // verbatim from claude's api_request + api_response_body events.
  // Payload risk is bounded: claude caps api_request_body +
  // api_response_body at 60KB INLINE per event; the langwatch receiver
  // adds a defense-in-depth content cap on top.
  const claudeCodeEnvBlock = isClaudeCode
    ? [
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
      ].join("\n")
    : "";

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
              <Text>New secret minted - old valid for 24h</Text>
            </HStack>
          </DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              This is the only time we&apos;ll show this secret. Save it
              somewhere safe and paste it into the upstream platform&apos;s
              admin console. The previous secret keeps working for 24h so you
              have time to roll the new value through every upstream client.
            </Text>
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
                  OTLP endpoint URL
                </Text>
                <Code padding={2} fontSize="xs">
                  {otlpUrl}
                </Code>
                {isClaudeCode && (
                  <Text fontSize="xs" color="fg.muted">
                    Paste this URL into Claude Code&apos;s{" "}
                    <Code fontSize="xs" backgroundColor="transparent">
                      OTEL_EXPORTER_OTLP_ENDPOINT
                    </Code>{" "}
                    - Claude Code&apos;s SDK appends{" "}
                    <Code fontSize="xs" backgroundColor="transparent">
                      /v1/logs
                    </Code>{" "}
                    and{" "}
                    <Code fontSize="xs" backgroundColor="transparent">
                      /v1/metrics
                    </Code>{" "}
                    itself.
                  </Text>
                )}
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
                  Paste in your Claude Code shell, then run{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    claude
                  </Code>
                  . To attribute spend to a specific team, also export{" "}
                  <Code fontSize="xs" backgroundColor="transparent">
                    OTEL_RESOURCE_ATTRIBUTES=team.id=…
                  </Code>{" "}
                  - it lands as a resource attribute and slots into
                  /governance&apos;s spendByTeam without further config.
                  Department attribution is resolved from the project&apos;s
                  assignment at read time, not from an OTEL attribute.
                </Text>
              </VStack>
            )}
            {usesWebhookUrl && (
              <VStack align="stretch" gap={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Webhook URL
                </Text>
                <Code padding={2} fontSize="xs">
                  {webhookUrl}
                </Code>
              </VStack>
            )}
          </VStack>
        </DialogBody>
        <DialogFooter>
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
  })(IngestionSourceDetailPage),
);
