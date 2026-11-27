// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Banner } from "@langwatch/design-system/banner";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { Dialog } from "@langwatch/design-system/dialog";
import { Badge, Button, Code, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";

import { SOURCE_TYPE_LABEL } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { Link } from "../../../../ui/elements/governance-link.tsx";
import {
  buildClaudeCodeEnvBlock,
  buildTestCurl,
  type SecretDetails,
  secretModalTargets,
} from "./secret-modal-commands.ts";

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
        <Code flex={1} padding={2} fontSize="xs" whiteSpace="pre-wrap" wordBreak="break-all">
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
        <Code
          flex={1}
          minWidth={0}
          padding={2}
          fontSize="xs"
          whiteSpace="normal"
          overflowWrap="anywhere"
        >
          {webhookUrl}
        </Code>
        <Button
          size="sm"
          variant="outline"
          flexShrink={0}
          aria-label="Copy webhook URL"
          onClick={() => onCopy(webhookUrl)}
        >
          <Copy size={14} />
        </Button>
      </HStack>
    </VStack>
  );
}

/** The one-shot warning, and how long the old secret keeps working. */
function SecretGraceNotice() {
  return (
    <Banner status="warning">
      <strong>Important:</strong> the secret above will not be shown again. We retained the prior
      secret&apos;s hash for a 24h grace window if you&apos;re rotating, so you have time to roll
      the new value through every upstream client.
    </Banner>
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
        <Code
          flex={1}
          minWidth={0}
          padding={2}
          fontSize="xs"
          whiteSpace="normal"
          overflowWrap="anywhere"
        >
          {otlpUrl}
        </Code>
        <Button
          size="sm"
          variant="outline"
          flexShrink={0}
          aria-label="Copy ingestion endpoint"
          onClick={() => onCopy(otlpUrl)}
        >
          <Copy size={14} />
        </Button>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        Spans push into the LangWatch trace store with this source&apos;s origin tag and become
        viewable in the trace viewer. If you are sending agent traces from your own LangWatch SDK,
        use <Code fontSize="xs">/api/otel/v1/traces</Code> with your project API key - different
        auth, same trace store. See{" "}
        <Link
          href="https://docs.langwatch.ai/observability/trace-vs-activity-ingestion"
          color="blue.fg"
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
      <Code padding={3} fontSize="xs" whiteSpace="pre" display="block" overflowX="auto">
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
        itself off the base endpoint. To attribute spend to a specific team or department, also
        export{" "}
        <Code fontSize="xs" backgroundColor="transparent">
          OTEL_RESOURCE_ATTRIBUTES=team.id=…,department=…
        </Code>{" "}
        - those land as resource attributes and slot into /governance&apos;s spendByTeam without
        further config.
      </Text>
    </VStack>
  );
}

/** The smoke-test curl, and how to read what it returns. */
function TestCurlPanel({ curl }: { curl: string }) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Test it now - paste this into a terminal
      </Text>
      <CodePreview code={curl} language="bash" filename="terminal" />
      <Text fontSize="xs" color="fg.muted">
        Returns HTTP 202 with <Code fontSize="xs">events: 1</Code> on success. If you get{" "}
        <Code fontSize="xs">events: 0</Code> with a hint, the body shape didn&apos;t parse - check
        the docs.
      </Text>
    </VStack>
  );
}

/** Which source the secret belongs to: its name and its type. */
function SourceSummaryPanel({ details }: { details: SecretDetails }) {
  return (
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
  );
}

export function SecretModal({
  details,
  onClose,
}: {
  details: SecretDetails | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { otlpUrl, webhookUrl, usesPushUrl, usesWebhookUrl, isClaudeCode } =
    secretModalTargets(details);

  const claudeCodeEnvBlock =
    isClaudeCode && details ? buildClaudeCodeEnvBlock({ details, otlpUrl }) : "";

  const testCurl = details
    ? buildTestCurl({
        details,
        otlpUrl,
        webhookUrl,
        usesPushUrl,
        usesWebhookUrl,
      })
    : null;

  if (!details) return null;

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={details.title}
      icon={<KeyRound size={16} />}
      closeOnInteractOutside={false}
      note={<Link href={`/governance/inventory/${details.sourceId}`}>View source page →</Link>}
      primaryAction={{ label: "I've saved it", onClick: onClose }}
      cancelLabel={null}
    >
      <VStack align="stretch" gap={4}>
        <Text fontSize="sm" color="fg.muted">
          This is the only time we&apos;ll show this secret. Save it somewhere safe and paste it
          into the upstream platform&apos;s admin console. We store only its hash.
        </Text>
        <SourceSummaryPanel details={details} />
        <IngestSecretPanel secret={details.secret} copied={copied} onCopy={copy} />
        {usesPushUrl && <OtlpEndpointPanel otlpUrl={otlpUrl} onCopy={copy} />}
        {usesWebhookUrl && <WebhookEndpointPanel webhookUrl={webhookUrl} onCopy={copy} />}
        {isClaudeCode && <ClaudeCodeEnvBlockPanel envBlock={claudeCodeEnvBlock} onCopy={copy} />}
        {testCurl && <TestCurlPanel curl={testCurl} />}
        <SecretGraceNotice />
      </VStack>
    </Dialog>
  );
}
