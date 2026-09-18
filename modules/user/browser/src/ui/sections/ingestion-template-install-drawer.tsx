import { Alert, Badge, Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { usePersonalToaster } from "../../behavior/personal-workspace-feedback.ts";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";

const SECRET_MASK = "•".repeat(48);

export function buildEnvSnippet(slug: string, endpoint: string, token: string): string {
  const base = `export OTEL_EXPORTER_OTLP_ENDPOINT="${endpoint}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${token}"`;
  if (slug === "claude_code") {
    // Claude Code OTel trace flags: enable span tracing + full session details
    // (prompts, tool calls, API bodies).
    return [
      `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
      `export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`,
      `export OTEL_TRACES_EXPORTER=otlp`,
      `export OTEL_LOGS_EXPORTER=otlp`,
      `export OTEL_METRICS_EXPORTER=otlp`,
      `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      `export OTEL_LOG_USER_PROMPTS=1`,
      `export OTEL_LOG_TOOL_DETAILS=1`,
      `export OTEL_LOG_TOOL_CONTENT=1`,
      `export OTEL_LOG_RAW_API_BODIES=1`,
      base,
      `export OTEL_RESOURCE_ATTRIBUTES="service.name=claude-code"`,
    ].join("\n");
  }
  if (slug === "codex") {
    // Codex 0.130+ reads standard OTEL_EXPORTER_OTLP_* env vars, but the
    // exporter is gated on a [otel] block in ~/.codex/config.toml — the CLI
    // command below writes it idempotently; the export block covers CI/devcontainers/agents.
    return [
      `# Run once: langwatch ingest install codex`,
      `# (writes the [otel] block to ~/.codex/config.toml automatically)`,
      `export OTEL_TRACES_EXPORTER=otlp`,
      `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      base,
      `export OTEL_RESOURCE_ATTRIBUTES="service.name=codex"`,
    ].join("\n");
  }
  if (slug === "gemini") {
    // gemini-cli 0.46 only forwards OTLP via target=local + useCollector=true
    // (in-process exporters to @opentelemetry/exporter-trace/logs-otlp-http).
    // traces=true enables spans; logPrompts=true embeds prompt text for langwatch.input.
    return [
      `export GEMINI_TELEMETRY_ENABLED=true`,
      `export GEMINI_TELEMETRY_TARGET=local`,
      `export GEMINI_TELEMETRY_USE_COLLECTOR=true`,
      `export GEMINI_TELEMETRY_TRACES_ENABLED=true`,
      `export GEMINI_TELEMETRY_OTLP_PROTOCOL=http`,
      `export GEMINI_TELEMETRY_OTLP_ENDPOINT="${endpoint}"`,
      `export GEMINI_TELEMETRY_LOG_PROMPTS=true`,
      `export OTEL_TRACES_EXPORTER=otlp`,
      `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      base,
      `export OTEL_RESOURCE_ATTRIBUTES="service.name=gemini-cli"`,
    ].join("\n");
  }
  if (slug === "opencode") {
    return [
      `export OTEL_TRACES_EXPORTER=otlp`,
      `export OTEL_LOGS_EXPORTER=otlp`,
      `export OTEL_METRICS_EXPORTER=otlp`,
      `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      base,
      `export OTEL_RESOURCE_ATTRIBUTES="service.name=opencode"`,
    ].join("\n");
  }
  return base;
}

export type IngestionTemplateMeta = {
  slug: string;
  displayName: string;
  description?: string | null;
  /**
   * Credential schema discriminator: null (token-only), "static_api_key", or "agent_id".
   */
  credentialSchema: string | null;
};

export type IngestionBindingResult = {
  /** Plaintext sk-lw- ingestion-key token — shown ONCE, copied by user. */
  token: string;
  /** OTLP endpoint URL (`{BASE_HOST}/api/otel`). */
  endpoint: string;
};

/**
 * Install drawer for ingestion template tiles (auto-issue token, show env-var snippet).
 */
export function IngestionTemplateInstallDrawer({
  open,
  onOpenChange,
  template,
  installResult,
  isInstalling,
  installError,
  hasExistingKey,
  onInstall,
  onRotate,
  onMarkInstalled,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  template: IngestionTemplateMeta;
  /** Set by parent when onInstall resolves. Cleared on close. */
  installResult: IngestionBindingResult | null;
  isInstalling: boolean;
  /** The install/rotate mutation's error, passed straight through. */
  installError: unknown;
  /**
   * True when the user already has an ingestion key for this source, driving
   * the CTA copy: 'Use this template' (fresh) vs 'Rotate token' (replace).
   * Without it the drawer would mint-only on an already-connected source.
   */
  hasExistingKey: boolean;
  /**
   * Called when the drawer mounts (or the user clicks 'Install') for the
   * given template. Parent owns the tRPC mutation
   * (`api.ingestionKey.install.useMutation()`).
   */
  onInstall: () => void;
  /**
   * Called when the user clicks 'Rotate token' on an already-connected
   * source. Parent owns the rotate mutation; the previous token is
   * invalidated immediately (hard-cut v1).
   */
  onRotate: () => void;
  /**
   * Called when the user clicks 'Mark as installed'. Parent closes the
   * drawer + marks the tile green-checked. Distinct from 'cancel' so
   * "user copied the token but didn't paste yet" is a recoverable state.
   */
  onMarkInstalled: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const toaster = usePersonalToaster();

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toaster.create({ title: `${label} copied to clipboard`, type: "success" });
  };

  const renderedToken = showSecret ? (installResult?.token ?? "") : SECRET_MASK;
  const copyToken = installResult?.token ?? "";

  // Claude Code requires CLAUDE_CODE_ENABLE_TELEMETRY + OTEL_LOGS_EXPORTER +
  // OTEL_METRICS_EXPORTER + OTEL_EXPORTER_OTLP_PROTOCOL. Other sources need
  // only endpoint + bearer token.
  const envVarsSnippet = installResult
    ? buildEnvSnippet(template.slug, installResult.endpoint, renderedToken)
    : "";
  const envVarsCopy = installResult
    ? buildEnvSnippet(template.slug, installResult.endpoint, copyToken)
    : "";

  return (
    <Drawer.Root open={open} onOpenChange={(d) => onOpenChange(d.open)} placement="end" size="md">
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Connect {template.displayName}, auto-shaped</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              Cost, tokens, and model are picked up automatically on every request, no change to how
              you call the API.
            </Text>

            {!!installError && (
              <HandledErrorAlert
                error={installError}
                fallbackTitle="Couldn't set up this integration"
              />
            )}

            {!installResult &&
              !isInstalling &&
              template.credentialSchema === null &&
              (hasExistingKey ? (
                <VStack align="stretch" gap={2}>
                  <Alert.Root status="warning" variant="surface">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Text fontSize="sm">
                        An ingestion key already exists for this source. Rotating will invalidate
                        the existing token immediately.
                      </Text>
                    </Alert.Content>
                  </Alert.Root>
                  <Button onClick={onRotate} colorPalette="orange">
                    Rotate token
                  </Button>
                </VStack>
              ) : (
                <Button onClick={onInstall} colorPalette="orange">
                  Use this template
                </Button>
              ))}

            {isInstalling && (
              <Text fontSize="sm" color="fg.muted">
                {hasExistingKey ? "Rotating token…" : "Installing template…"}
              </Text>
            )}

            {installResult && (
              <>
                <Alert.Root status="info" variant="surface">
                  <Alert.Indicator>
                    <Check size={16} />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Text fontSize="sm" fontWeight="medium">
                      Ingestion key issued. Copy the token now, it won't be shown again.
                    </Text>
                  </Alert.Content>
                </Alert.Root>

                <Field
                  label="Endpoint"
                  value={installResult.endpoint}
                  onCopy={() => copy(installResult.endpoint, "Endpoint")}
                />
                <Field
                  label="Token"
                  value={showSecret ? installResult.token : SECRET_MASK}
                  onCopy={() => copy(installResult.token, "Token")}
                  trailing={
                    <Button size="xs" variant="ghost" onClick={() => setShowSecret((v) => !v)}>
                      {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                      {showSecret ? "Hide" : "Show"}
                    </Button>
                  }
                />

                <Box
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="sm"
                  padding={3}
                  backgroundColor="bg.subtle"
                >
                  <HStack alignItems="start" marginBottom={2}>
                    <Text fontSize="xs" color="fg.muted" fontWeight="semibold">
                      .env (bash)
                    </Text>
                    <Spacer />
                    <Button size="xs" variant="ghost" onClick={() => copy(envVarsCopy, "Env vars")}>
                      <Copy size={12} /> Copy
                    </Button>
                  </HStack>
                  <Box as="pre" fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap">
                    {envVarsSnippet}
                  </Box>
                </Box>

                <Text fontSize="xs" color="fg.muted">
                  Paste into your{" "}
                  <Badge variant="surface" size="sm">
                    {template.displayName}
                  </Badge>{" "}
                  environment, fire a request, and traces will land at <code>/me/traces</code>{" "}
                  filtered by source={template.slug}.
                </Text>

                <Text fontSize="xs" color="fg.muted">
                  To keep this across new terminals, add these lines to your <code>~/.zshrc</code>{" "}
                  (or <code>~/.bashrc</code>), then open a new shell.
                </Text>

                <HStack>
                  <Spacer />
                  <Button onClick={onMarkInstalled} colorPalette="green" variant="solid">
                    <Check size={14} /> Mark as installed
                  </Button>
                </HStack>
              </>
            )}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function Field({
  label,
  value,
  onCopy,
  trailing,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" color="fg.muted" fontWeight="semibold">
        {label}
      </Text>
      <HStack
        gap={2}
        paddingX={2}
        paddingY={2}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="sm"
        backgroundColor="bg.subtle"
      >
        <Text fontSize="xs" fontFamily="mono" wordBreak="break-all" flex={1}>
          {value}
        </Text>
        {trailing}
        <Button size="xs" variant="ghost" onClick={onCopy}>
          <Copy size={12} /> Copy
        </Button>
      </HStack>
    </VStack>
  );
}
