import {
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { getDocsBaseUrl } from "~/utils/docsUrl";

import { TileIcon } from "./TileIcon";
import type { CodingAssistantConfig } from "./types";

/**
 * Admins typed the canonical `https://docs.langwatch.ai/...` URL when
 * curating the catalog — but on a localhost dev install where Mintlify
 * is also running locally, those clicks should land on the worktree's
 * docs preview instead of bouncing to production. Rewrite the host
 * piece transparently at render time so admin-stored URLs round-trip
 * to whichever docs host matches the user's current control plane.
 * Foreign URLs (acme-internal docs, public links the admin pasted on
 * purpose) are returned untouched.
 */
const PRODUCTION_DOCS_HOST = "docs.langwatch.ai";

function rewriteDocsHostForLocalDev(url: string | undefined): string | undefined {
  if (!url) return url;
  // Parse and compare hosts explicitly so an attacker URL like
  // `https://docs.langwatch.ai.evil.example/...` cannot be rewritten
  // through a substring/startsWith match.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" || parsed.host !== PRODUCTION_DOCS_HOST) {
    return url;
  }
  const base = getDocsBaseUrl();
  if (base === `https://${PRODUCTION_DOCS_HOST}`) return url;
  return base + parsed.pathname + parsed.search + parsed.hash;
}

interface Props {
  displayName: string;
  config: CodingAssistantConfig;
  iconAsset?: string | null;
  iconKey?: string | null;
  /**
   * Catalog slug — drives surface-specific UX. Today only `claude-code`
   * gets the optional OTLP-from-existing-OAuth section (Anthropic
   * monitoring-usage path, see Sergey baf9445e3 receiver). Other
   * assistants surface the bare wrapper-command flow today.
   */
  slug?: string;
}

const ENDPOINT_PLACEHOLDER = "<your-org-LangWatch-ingestion-URL>";

function buildClaudeCodeOtlpEnvBlock(endpoint: string | null): string {
  return [
    `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
    `export OTEL_LOGS_EXPORTER=otlp`,
    `export OTEL_METRICS_EXPORTER=otlp`,
    `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
    `export OTEL_EXPORTER_OTLP_ENDPOINT="${endpoint ?? ENDPOINT_PLACEHOLDER}"`,
    `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ingest-secret-from-admin>"`,
  ].join("\n");
}

export function CodingAssistantTile({
  displayName,
  config,
  iconAsset,
  iconKey,
  slug,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [otlpCopied, setOtlpCopied] = useState(false);
  const isClaudeCode = slug === "claude-code";

  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  // Auto-fill the URL when the admin has already published a
  // claude_code IngestionSource in the org. Only the bearer token
  // stays in the admin-handoff path (ingestSecret is hash-only on
  // the server). Falls back to the all-placeholder template when no
  // source has been published yet — copy still works, just with
  // both fields as <…> placeholders.
  const otlpEndpointQuery = api.aiTools.claudeCodeOtlpEndpoint.useQuery(
    { organizationId: orgId },
    {
      enabled: isClaudeCode && expanded && !!orgId,
      refetchOnWindowFocus: false,
    },
  );
  const resolvedEndpoint = useMemo(() => {
    const path = otlpEndpointQuery.data?.endpoint;
    if (!path) return null;
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  }, [otlpEndpointQuery.data]);
  const claudeCodeEnvBlock = useMemo(
    () => buildClaudeCodeOtlpEnvBlock(resolvedEndpoint),
    [resolvedEndpoint],
  );

  const onCopy = () => {
    void navigator.clipboard.writeText(config.setupCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onCopyOtlpTemplate = () => {
    void navigator.clipboard.writeText(claudeCodeEnvBlock);
    setOtlpCopied(true);
    setTimeout(() => setOtlpCopied(false), 1500);
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      width="full"
    >
      <HStack
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        gap={3}
      >
        <TileIcon
          iconAsset={iconAsset}
          iconKey={iconKey}
          type="coding_assistant"
        />
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Coding assistant
          </Text>
        </VStack>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </HStack>

      {expanded && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Text fontSize="sm" color="fg.muted">
            Run this in your terminal:
          </Text>
          <HStack
            gap={2}
            padding={2}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="sm"
            backgroundColor="bg.subtle"
          >
            <Code flex={1} backgroundColor="transparent" fontSize="sm">
              $ {config.setupCommand}
            </Code>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={copied ? "Copied" : "Copy command"}
              onClick={onCopy}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </HStack>

          {config.helperText && (
            <Text fontSize="xs" color="fg.muted">
              {config.helperText}
            </Text>
          )}

          {config.setupDocsUrl && (
            <Button
              size="xs"
              variant="outline"
              asChild
              alignSelf="start"
            >
              <a
                href={rewriteDocsHostForLocalDev(config.setupDocsUrl)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                Setup guide <ExternalLink size={12} />
              </a>
            </Button>
          )}

          {isClaudeCode && (
            <Box
              marginTop={2}
              paddingTop={3}
              borderTop="1px solid"
              borderColor="border.muted"
            >
              <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                Already using Claude Code with your Anthropic OAuth login?
              </Text>
              <Text fontSize="xs" color="fg.muted" marginBottom={2}>
                Keep your existing seat — your admin can publish a
                LangWatch OTLP ingestion source so spend, anomaly rules,
                and budgets work against your Claude Code traffic without
                changing how you call the API. Paste the env block below
                in your shell once your admin shares the bearer token.
              </Text>
              <HStack justifyContent="space-between" marginBottom={1}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Shell env block
                </Text>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={onCopyOtlpTemplate}
                >
                  <Copy size={12} /> {otlpCopied ? "Copied" : "Copy"}
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
              <Text fontSize="xs" color="fg.muted" marginTop={2}>
                Replace{" "}
                <Code fontSize="xs" backgroundColor="transparent">
                  &lt;ingest-secret-from-admin&gt;
                </Code>{" "}
                with the bearer token your admin shares
                {resolvedEndpoint ? null : (
                  <>
                    {" "}and{" "}
                    <Code fontSize="xs" backgroundColor="transparent">
                      &lt;your-org-LangWatch-ingestion-URL&gt;
                    </Code>{" "}
                    once they publish a Claude Code OTLP source
                  </>
                )}
                . Optional: also export{" "}
                <Code fontSize="xs" backgroundColor="transparent">
                  OTEL_RESOURCE_ATTRIBUTES=team.id=…,cost_center=…
                </Code>{" "}
                for team / department slicing.
              </Text>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
}
