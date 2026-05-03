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
  RotateCw,
  Trash2,
} from "lucide-react";
import numeral from "numeral";
import { useState } from "react";

import { EnterpriseLockedSurface } from "~/components/enterprise/EnterpriseLockedSurface";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
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
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Per-source detail page — health metrics + recent events with raw vs
 * normalised side-by-side. Wired to api.activityMonitor.eventsForSource +
 * sourceHealthMetrics (Sergey f2cb9de7a).
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (scenario "Per-source detail page shows health")
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

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.0000");

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

function IngestionSourceDetailPage() {
  const router = useRouter();
  const sourceId = router.query.id as string | undefined;
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

  const sourceQuery = api.ingestionSources.get.useQuery(
    { organizationId: orgId, id: sourceId ?? "" },
    { enabled: !!orgId && !!sourceId, refetchOnWindowFocus: false },
  );
  const healthQuery = api.activityMonitor.sourceHealthMetrics.useQuery(
    { organizationId: orgId, sourceId: sourceId ?? "" },
    { enabled: !!orgId && !!sourceId, refetchOnWindowFocus: false },
  );
  const eventsQuery = api.activityMonitor.eventsForSource.useQuery(
    { organizationId: orgId, sourceId: sourceId ?? "", limit: 50 },
    { enabled: !!orgId && !!sourceId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const [secretReveal, setSecretReveal] = useState<{
    secret: string;
    sourceName: string;
  } | null>(null);

  const rotateMutation = api.ingestionSources.rotateSecret.useMutation({
    onSuccess: (data) => {
      void utils.ingestionSources.get.invalidate({
        organizationId: orgId,
        id: sourceId,
      });
      setSecretReveal({
        secret: data.ingestSecret,
        sourceName: data.source.name,
      });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to rotate secret",
        description: e.message,
        type: "error",
      }),
  });
  const archiveMutation = api.ingestionSources.archive.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Source archived", type: "success" });
      void router.push("/settings/governance/ingestion-sources");
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to archive",
        description: e.message,
        type: "error",
      }),
  });

  if (ffLoading) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }
  if (!sourceId) {
    return <NotFoundScene />;
  }
  if (sourceQuery.isError) {
    return <NotFoundScene />;
  }

  const source = sourceQuery.data;
  const health = healthQuery.data;
  const events = eventsQuery.data ?? [];

  if (!source) {
    return (
      <SettingsLayout>
        <EnterpriseLockedSurface
          featureName="Ingestion Source detail"
          description="Source-level health metrics and event drill-downs are part of the Enterprise plan."
        >
          <Spinner size="sm" />
        </EnterpriseLockedSurface>
      </SettingsLayout>
    );
  }

  const status =
    STATUS_META[source.status] ?? STATUS_META.awaiting_first_event!;
  const StatusIcon = status.icon;

  return (
    <SettingsLayout>
      <EnterpriseLockedSurface
        featureName="Ingestion Source detail"
        description="Source-level health metrics and event drill-downs are part of the Enterprise plan."
      >
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Link
                href="/settings/governance/ingestion-sources"
                color="orange.600"
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
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              rotateMutation.mutate({ organizationId: orgId, id: source.id })
            }
            loading={rotateMutation.isPending}
            title="Mint a new ingestSecret (24h grace on the old one)"
          >
            <RotateCw size={14} /> Rotate secret
          </Button>
          <Button
            size="sm"
            variant="ghost"
            colorPalette="red"
            onClick={() => {
              if (!confirm(`Archive "${source.name}"? Historical events stay readable.`)) return;
              archiveMutation.mutate({ organizationId: orgId, id: source.id });
            }}
            loading={archiveMutation.isPending}
          >
            <Trash2 size={14} /> Archive
          </Button>
        </HStack>

        <SimpleGrid columns={{ base: 2, md: 4 }} gap={4}>
          <MetricCard
            title="Events 24h"
            value={numeral(health?.events24h ?? 0).format("0,0")}
            isLoading={healthQuery.isLoading}
          />
          <MetricCard
            title="Events 7d"
            value={numeral(health?.events7d ?? 0).format("0,0")}
            isLoading={healthQuery.isLoading}
          />
          <MetricCard
            title="Events 30d"
            value={numeral(health?.events30d ?? 0).format("0,0")}
            isLoading={healthQuery.isLoading}
          />
          <MetricCard
            title="Last event"
            value={fmtRelative(health?.lastSuccessIso ?? null)}
            isLoading={healthQuery.isLoading}
          />
        </SimpleGrid>

        <StaleTimestampCallout
          health={health ?? null}
          eventsCount={events.length}
        />

        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={5}
        >
          <VStack align="start" gap={1} marginBottom={3}>
            <Heading as="h3" size="sm">
              Recent events
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              Last {events.length} OCSF-normalised events from this source.
              Raw payload + normalised fields shown side-by-side. Newest
              first.
            </Text>
          </VStack>

          {eventsQuery.isLoading && <Spinner size="sm" />}

          {!eventsQuery.isLoading && events.length === 0 && (
            <EmptyEventsHint source={source} />
          )}

          {events.length > 0 && (
            <VStack align="stretch" gap={2}>
              {events.map((ev) => (
                <EventRow key={ev.eventId} event={ev} />
              ))}
            </VStack>
          )}
        </Box>
      </VStack>

      <SecretRevealModal
        details={secretReveal}
        sourceId={source.id}
        sourceType={source.sourceType}
        onClose={() => setSecretReveal(null)}
      />
      </EnterpriseLockedSurface>
    </SettingsLayout>
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
  // — they appear contradictory. Surface a callout that names the
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
        <strong>Heads up:</strong> the events list shows {eventsCount}{" "}
        event{eventsCount === 1 ? "" : "s"}, but the rolling
        24h&nbsp;/&nbsp;7d&nbsp;/&nbsp;30d health windows are all zero.
        Your events likely have a stale{" "}
        <Code fontSize="xs">startTimeUnixNano</Code> (timestamps before
        today). When firing test events, set{" "}
        <Code fontSize="xs">startTimeUnixNano</Code> to{" "}
        <Code fontSize="xs">String(Date.now() * 1_000_000)</Code> so the
        event lands inside the rolling window. The secret-reveal
        modal&apos;s &quot;Test it now&quot; curl already does this for
        you.
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
        <Code fontSize="xs">{endpoint}</Code> with the source&apos;s
        bearer secret to start populating.
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Spans land in the LangWatch trace store with this
        source&apos;s origin tag, viewable in the trace viewer. If
        you are sending agent traces from your own LangWatch SDK,
        use <Code fontSize="xs">/api/otel/v1/traces</Code> with your
        project API key — different auth, same trace store. See{" "}
        <Link
          href="https://docs.langwatch.ai/observability/trace-vs-activity-ingestion"
          color="orange.600"
        >
          Choosing the right OTel endpoint
        </Link>
        .
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Lost the secret? Click <strong>Rotate secret</strong> above —
        the new bearer is shown once with a copy-paste curl example, and
        the prior secret stays valid for 24h while you roll the new
        value through every upstream client.
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
            Returns HTTP 202 with{" "}
            <Code fontSize="xs">events: 1</Code> on success. If you get{" "}
            <Code fontSize="xs">events: 0</Code> with a hint, the body
            shape didn&apos;t parse. See the{" "}
            <Link
              href="https://docs.langwatch.ai/ai-gateway/governance/ingestion-sources/otel-generic"
              color="orange.600"
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

function EventRow({ event }: { event: EventRow }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={3}
    >
      <HStack
        gap={3}
        cursor="pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <HStack gap={2} wrap="wrap">
            <Badge size="sm" variant="surface">
              {event.eventType}
            </Badge>
            <Text fontSize="sm" fontWeight="medium">
              {event.actor}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              · {event.action}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {event.target ? `→ ${event.target}` : ""}
            </Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {fmtRelative(event.eventTimestampIso)} · cost{" "}
            {fmtUsd(event.costUsd)}
            {(event.tokensInput > 0 || event.tokensOutput > 0) && (
              <>
                {" · "}
                {numeral(event.tokensInput).format("0,0")} →{" "}
                {numeral(event.tokensOutput).format("0,0")} tokens
              </>
            )}
          </Text>
        </VStack>
        <Text fontSize="xs" color="fg.muted">
          {expanded ? "▲" : "▼"}
        </Text>
      </HStack>
      {expanded && (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3} marginTop={3}>
          <NormalisedPanel event={event} />
          <RawPanel event={event} />
        </SimpleGrid>
      )}
    </Box>
  );
}

function NormalisedPanel({ event }: { event: EventRow }) {
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" marginBottom={1}>
        Normalised (OCSF)
      </Text>
      <Code
        display="block"
        padding={3}
        fontSize="xs"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        backgroundColor="bg.subtle"
      >
        {JSON.stringify(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            actor: event.actor,
            action: event.action,
            target: event.target,
            costUsd: event.costUsd,
            tokensInput: event.tokensInput,
            tokensOutput: event.tokensOutput,
            eventTimestamp: event.eventTimestampIso,
            ingestedAt: event.ingestedAtIso,
          },
          null,
          2,
        )}
      </Code>
    </Box>
  );
}

function RawPanel({ event }: { event: EventRow }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(event.rawPayload);
  } catch {
    // not JSON, render as text
  }
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" marginBottom={1}>
        Raw payload (as ingested)
      </Text>
      <Code
        display="block"
        padding={3}
        fontSize="xs"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        backgroundColor="bg.subtle"
      >
        {parsed != null ? JSON.stringify(parsed, null, 2) : event.rawPayload}
      </Code>
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
    sourceType === "otel_generic" || sourceType === "claude_cowork";
  const usesWebhookUrl = sourceType === "workato";

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
              <Text>New secret minted — old valid for 24h</Text>
            </HStack>
          </DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              This is the only time we&apos;ll show this secret. Save it
              somewhere safe and paste it into the upstream platform&apos;s
              admin console. The previous secret keeps working for 24h so
              you have time to roll the new value through every upstream
              client.
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

export default withPermissionGuard("organization:manage", { bypassOnboardingRedirect: true })(
  IngestionSourceDetailPage,
);
