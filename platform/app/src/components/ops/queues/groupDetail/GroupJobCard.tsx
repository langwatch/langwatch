import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { formatBytes, formatTimeAgo } from "@langwatch/ops-web";
import { PinnedAwareJsonView } from "~/features/traces-v2/components/TraceDrawer/JsonHighlight";
import type { JobEntry } from "~/server/app-layer/ops/repositories/queue.repository";
import {
  type GrafanaDeepLinkConfig,
  grafanaTraceUrl,
} from "~/utils/grafanaLinks";
import { middleEllipsis } from "../clusterGroups";
import { type JobContextInfo, readJobContext, readJobKind } from "./jobContext";

const NO_PINNED_KEYS: ReadonlySet<string> = new Set();

function ContextRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | null;
}) {
  return (
    <HStack gap={2} align="baseline">
      <Text textStyle="xs" color="fg.muted" width="90px" flexShrink={0}>
        {label}
      </Text>
      {href ? (
        <Text
          asChild
          textStyle="xs"
          fontFamily="mono"
          color="blue.fg"
          title={value}
          _hover={{ textDecoration: "underline" }}
        >
          <a href={href} target="_blank" rel="noreferrer">
            {middleEllipsis(value, 40)} ↗
          </a>
        </Text>
      ) : (
        <Text textStyle="xs" fontFamily="mono" title={value}>
          {middleEllipsis(value, 40)}
        </Text>
      )}
    </HStack>
  );
}

function JobHeaderRow({
  job,
  now,
  showJson,
  onToggleJson,
}: {
  job: JobEntry;
  now: number;
  showJson: boolean;
  onToggleJson: () => void;
}) {
  return (
    <HStack gap={2}>
      <Text
        textStyle="xs"
        fontFamily="mono"
        truncate
        title={job.jobId}
        flexShrink={1}
      >
        {job.jobId}
      </Text>
      <Spacer />
      {job.payloadBytes !== null && (
        <Text textStyle="xs" color="fg.muted" flexShrink={0}>
          {formatBytes(job.payloadBytes)}
        </Text>
      )}
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        runs {formatTimeAgo(job.score, now)}
      </Text>
      <Button
        size="2xs"
        variant={showJson ? "solid" : "ghost"}
        onClick={onToggleJson}
        disabled={!job.data}
        flexShrink={0}
      >
        JSON
      </Button>
    </HStack>
  );
}

function JobChipsRow({ job }: { job: JobEntry }) {
  const kind = readJobKind(job.data);
  return (
    <HStack gap={1.5} flexWrap="wrap">
      {kind.jobType && (
        <Badge size="xs" colorPalette="teal" variant="subtle">
          {kind.jobType}
        </Badge>
      )}
      {kind.jobName && (
        <Badge size="xs" variant="subtle" fontFamily="mono">
          {kind.jobName}
        </Badge>
      )}
      {job.envelope?.blobId && (
        <Badge
          size="xs"
          colorPalette="purple"
          variant="subtle"
          fontFamily="mono"
          title={`Body offloaded to the payload store (${job.envelope.format ?? "?"}): ${job.envelope.blobId}`}
        >
          {job.envelope.format} blob {middleEllipsis(job.envelope.blobId, 14)}
        </Badge>
      )}
      {!job.data && (
        <Badge size="xs" colorPalette="orange" variant="subtle">
          body unavailable
        </Badge>
      )}
    </HStack>
  );
}

function JobContextRows({
  context,
  traceHref,
}: {
  context: JobContextInfo;
  traceHref: string | null;
}) {
  return (
    <Box>
      {context.traceId && (
        <ContextRow label="Trace" value={context.traceId} href={traceHref} />
      )}
      {context.projectId && (
        <ContextRow label="Project" value={context.projectId} />
      )}
      {context.userId && <ContextRow label="User" value={context.userId} />}
      {context.organizationId && (
        <ContextRow label="Organization" value={context.organizationId} />
      )}
    </Box>
  );
}

/**
 * One staged job, structurally: what it is (type, name), whose request staged
 * it (`__context`), where its body lives (payload store tier), and when it
 * runs. The full payload stays one click away behind the JSON toggle — the
 * structured lines answer the routine questions without making the operator
 * read a wall of JSON for each of twenty jobs.
 */
export function GroupJobCard({
  job,
  now,
  grafana,
}: {
  job: JobEntry;
  now: number;
  grafana?: GrafanaDeepLinkConfig | null;
}) {
  const [showJson, setShowJson] = useState(false);
  const context = readJobContext(job.data);
  const traceHref =
    context?.traceId && grafana
      ? grafanaTraceUrl(context.traceId, grafana)
      : null;

  return (
    <Card.Root variant="outline">
      <Card.Body padding={2.5} gap={2}>
        <JobHeaderRow
          job={job}
          now={now}
          showJson={showJson}
          onToggleJson={() => setShowJson((v) => !v)}
        />
        <JobChipsRow job={job} />
        {context && <JobContextRows context={context} traceHref={traceHref} />}
        {showJson && job.data && (
          <Box
            bg="bg.subtle"
            borderRadius="sm"
            padding={2}
            maxHeight="280px"
            overflow="auto"
          >
            <PinnedAwareJsonView
              content={JSON.stringify(job.data)}
              pinnedKeys={NO_PINNED_KEYS}
            />
          </Box>
        )}
      </Card.Body>
    </Card.Root>
  );
}
