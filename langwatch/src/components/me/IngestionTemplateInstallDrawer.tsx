import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import {
  Drawer,
  DrawerBody,
  DrawerCloseTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
} from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";

const SECRET_MASK = "•".repeat(48);

export type IngestionTemplateMeta = {
  slug: string;
  displayName: string;
  description?: string | null;
  /**
   * Discriminator for what extra credential metadata the drawer captures
   * from the user, mirrors `IngestionTemplate.credentialSchema`:
   *   null              → otlp_token-only (auto-issue, no input form)
   *   "static_api_key"  → drawer captures the user's upstream tool API key
   *   "agent_id"        → drawer captures an agent identifier
   * v1 ships only otlp_token-only templates; static_api_key + agent_id
   * forms ship in v1.1.
   */
  credentialSchema: string | null;
};

export type IngestionBindingResult = {
  /** Plaintext lwub_<base32> token — shown ONCE, copied by user. */
  token: string;
  /** OTLP endpoint URL (`{BASE_HOST}/api/otel`). */
  endpoint: string;
};

/**
 * Install drawer for an IngestionTemplate tile on /me Trace Ingest.
 *
 * v1 supports otlp_token-only templates (credentialSchema=null): the
 * drawer auto-issues on open via the parent's onInstall callback, then
 * shows the endpoint + lwub_* token + a copy-paste env-var snippet. The
 * token is plaintext-shown ONCE — once the drawer closes, the user can
 * still see the prefix on the tile but never the secret again.
 *
 * For credentialSchema="static_api_key" or "agent_id" (v1.1), the drawer
 * shows an input form first; install fires after submit. v1 does NOT
 * exercise this path because the 4 v1 catalog tiles all have
 * credentialSchema=null per `ingestion-templates-catalog.feature`
 * Background block.
 *
 * Hard-cut rotation v1: the drawer copy says "Old token no longer
 * accepted" on rotation. Grace-period drawer copy is deferred to v2.
 *
 * Spec: specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 */
export function IngestionTemplateInstallDrawer({
  open,
  onOpenChange,
  template,
  installResult,
  isInstalling,
  installError,
  onInstall,
  onMarkInstalled,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  template: IngestionTemplateMeta;
  /** Set by parent when onInstall resolves. Cleared on close. */
  installResult: IngestionBindingResult | null;
  isInstalling: boolean;
  installError: string | null;
  /**
   * Called when the drawer mounts (or the user clicks 'Install') for the
   * given template. Parent owns the tRPC mutation:
   *   `api.userIngestionBindings.install.useMutation()` (lands when
   *    Sergey's bindingService + tRPC router commit).
   */
  onInstall: () => void;
  /**
   * Called when the user clicks 'Mark as installed'. Parent closes the
   * drawer + marks the tile green-checked. Distinct from 'cancel' so
   * "user copied the token but didn't paste yet" is a recoverable state.
   */
  onMarkInstalled: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toaster.create({ title: `${label} copied to clipboard`, type: "success" });
  };

  const envVarsSnippet = installResult
    ? `export OTEL_EXPORTER_OTLP_ENDPOINT="${installResult.endpoint}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${
        showSecret ? installResult.token : SECRET_MASK
      }"`
    : "";

  return (
    <DrawerRoot
      open={open}
      onOpenChange={(d) => onOpenChange(d.open)}
      placement="end"
      size="md"
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            Connect {template.displayName} — auto-shaped
          </DrawerTitle>
          <DrawerCloseTrigger />
        </DrawerHeader>
        <DrawerBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              Traces normalized into <code>gen_ai.*</code> canonical.
              Cost/tokens/model populated automatically by the receiver.
            </Text>

            {installError && (
              <Alert.Root status="error" variant="surface">
                <Alert.Content>
                  <Text fontSize="sm">{installError}</Text>
                </Alert.Content>
              </Alert.Root>
            )}

            {!installResult && !isInstalling && template.credentialSchema === null && (
              <Button onClick={onInstall} colorPalette="orange">
                Issue binding token
              </Button>
            )}

            {isInstalling && (
              <Text fontSize="sm" color="fg.muted">
                Issuing binding token…
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
                      Binding issued. Copy the token now — it won't be
                      shown again.
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
                  value={
                    showSecret ? installResult.token : SECRET_MASK
                  }
                  onCopy={() => copy(installResult.token, "Token")}
                  trailing={
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setShowSecret((v) => !v)}
                    >
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
                    <Text
                      fontSize="xs"
                      color="fg.muted"
                      fontWeight="semibold"
                    >
                      .env (bash)
                    </Text>
                    <Spacer />
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        copy(
                          `export OTEL_EXPORTER_OTLP_ENDPOINT="${installResult.endpoint}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${installResult.token}"`,
                          "Env vars",
                        )
                      }
                    >
                      <Copy size={12} /> Copy
                    </Button>
                  </HStack>
                  <Box
                    as="pre"
                    fontSize="xs"
                    fontFamily="mono"
                    whiteSpace="pre-wrap"
                  >
                    {envVarsSnippet}
                  </Box>
                </Box>

                <Text fontSize="xs" color="fg.muted">
                  Paste into your{" "}
                  <Badge variant="surface" size="sm">
                    {template.displayName}
                  </Badge>{" "}
                  environment, fire a request, and traces will land at{" "}
                  <code>/me/traces</code> filtered by source={template.slug}.
                </Text>

                <HStack>
                  <Spacer />
                  <Button
                    onClick={onMarkInstalled}
                    colorPalette="green"
                    variant="solid"
                  >
                    <Check size={14} /> Mark as installed
                  </Button>
                </HStack>
              </>
            )}
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </DrawerRoot>
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
