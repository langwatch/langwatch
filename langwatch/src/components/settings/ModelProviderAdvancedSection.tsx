import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { SmallLabel } from "../SmallLabel";
import { toaster } from "../ui/toaster";
import { api } from "../../utils/api";

interface AdvancedDraft {
  rateLimitRpm: string;
  rateLimitTpm: string;
  rateLimitRpd: string;
  fallbackPriorityGlobal: string;
  providerConfigJson: string;
}

function intToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function inputToInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function jsonToInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/**
 * Advanced (Gateway) section on the ModelProviderForm. Surfaces the
 * gateway-routing knobs that landed on ModelProvider via S0 (iter 110)
 * after GatewayProviderCredential folded in:
 *
 *   - Rate limits (rpm / tpm / rpd) — optional caps the gateway
 *     enforces per ModelProvider on inbound requests.
 *   - Fallback priority — ordering tiebreak used when a VK has no
 *     RoutingPolicy. Lower wins; tiebreak by createdAt asc. Spec:
 *     specs/ai-gateway/governance/vk-config-bundle.feature.
 *   - Provider config — JSON for provider-specific routing hints
 *     (bedrock region, azure deployment override). Gateway applies
 *     on top of standard credentials.
 *
 * Health / circuit state are read-only (written by the gateway data
 * plane), rendered below the editable fields when present.
 *
 * Editable only for persisted ModelProviders (`id` set) — new rows
 * save the basic shape first via the main form, then come back here
 * to tune the advanced knobs.
 */
export function ModelProviderAdvancedSection({
  modelProviderId,
  initial,
}: {
  modelProviderId: string | undefined;
  initial: {
    rateLimitRpm: number | null;
    rateLimitTpm: number | null;
    rateLimitRpd: number | null;
    fallbackPriorityGlobal: number | null;
    providerConfig: unknown;
    healthStatus?: string | null;
    circuitOpenedAt?: Date | string | null;
    lastHealthCheckAt?: Date | string | null;
    disabledAt?: Date | string | null;
  };
}) {
  const [draft, setDraft] = useState<AdvancedDraft>({
    rateLimitRpm: intToInput(initial.rateLimitRpm),
    rateLimitTpm: intToInput(initial.rateLimitTpm),
    rateLimitRpd: intToInput(initial.rateLimitRpd),
    fallbackPriorityGlobal: intToInput(initial.fallbackPriorityGlobal),
    providerConfigJson: jsonToInput(initial.providerConfig),
  });
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateAdvanced =
    (api.modelProvider as any).updateAdvanced?.useMutation?.({
      onSuccess: () => {
        toaster.create({
          type: "success",
          title: "Advanced settings saved",
        });
      },
      onError: (err: unknown) => {
        toaster.create({
          type: "error",
          title: "Failed to save advanced settings",
          description: err instanceof Error ? err.message : String(err),
        });
      },
    }) ?? null;

  if (!modelProviderId) {
    return (
      <Box width="full" paddingY={2}>
        <SmallLabel>Advanced (Gateway)</SmallLabel>
        <Text fontSize="xs" color="gray.500">
          Save the provider first to configure rate limits and routing
          hints.
        </Text>
      </Box>
    );
  }

  const handleSave = () => {
    let providerConfig: Record<string, unknown> | null = null;
    if (draft.providerConfigJson.trim()) {
      try {
        providerConfig = JSON.parse(draft.providerConfigJson) as Record<
          string,
          unknown
        >;
      } catch (e) {
        setJsonError(
          e instanceof Error ? e.message : "Invalid JSON",
        );
        return;
      }
    }
    setJsonError(null);
    updateAdvanced?.mutate({
      id: modelProviderId,
      rateLimitRpm: inputToInt(draft.rateLimitRpm),
      rateLimitTpm: inputToInt(draft.rateLimitTpm),
      rateLimitRpd: inputToInt(draft.rateLimitRpd),
      fallbackPriorityGlobal: inputToInt(draft.fallbackPriorityGlobal),
      providerConfig,
    });
  };

  const formatDate = (d: Date | string | null | undefined): string => {
    if (!d) return "—";
    const date = typeof d === "string" ? new Date(d) : d;
    return Number.isFinite(date.getTime())
      ? date.toLocaleString()
      : String(d);
  };

  return (
    <VStack align="start" width="full" gap={3}>
      <SmallLabel>Advanced (Gateway)</SmallLabel>

      <HStack width="full" align="start" gap={3}>
        <Field.Root>
          <SmallLabel>RPM</SmallLabel>
          <Input
            type="number"
            min={0}
            placeholder="No cap"
            value={draft.rateLimitRpm}
            onChange={(e) =>
              setDraft((d) => ({ ...d, rateLimitRpm: e.target.value }))
            }
          />
          <Field.HelperText>Requests per minute.</Field.HelperText>
        </Field.Root>

        <Field.Root>
          <SmallLabel>TPM</SmallLabel>
          <Input
            type="number"
            min={0}
            placeholder="No cap"
            value={draft.rateLimitTpm}
            onChange={(e) =>
              setDraft((d) => ({ ...d, rateLimitTpm: e.target.value }))
            }
          />
          <Field.HelperText>Tokens per minute.</Field.HelperText>
        </Field.Root>

        <Field.Root>
          <SmallLabel>RPD</SmallLabel>
          <Input
            type="number"
            min={0}
            placeholder="No cap"
            value={draft.rateLimitRpd}
            onChange={(e) =>
              setDraft((d) => ({ ...d, rateLimitRpd: e.target.value }))
            }
          />
          <Field.HelperText>Requests per day.</Field.HelperText>
        </Field.Root>
      </HStack>

      <Field.Root>
        <SmallLabel>Fallback priority</SmallLabel>
        <Input
          type="number"
          placeholder="Auto"
          value={draft.fallbackPriorityGlobal}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              fallbackPriorityGlobal: e.target.value,
            }))
          }
        />
        <Field.HelperText>
          Order used when a Virtual Key has no Routing Policy. Lower
          tries first. Tiebreak by creation order.
        </Field.HelperText>
      </Field.Root>

      <Field.Root>
        <SmallLabel>Provider config (JSON)</SmallLabel>
        <Textarea
          rows={4}
          placeholder={`{\n  "region": "us-east-1"\n}`}
          fontFamily="mono"
          fontSize="xs"
          value={draft.providerConfigJson}
          onChange={(e) =>
            setDraft((d) => ({ ...d, providerConfigJson: e.target.value }))
          }
        />
        {jsonError ? (
          <Text fontSize="xs" color="red.500">
            {jsonError}
          </Text>
        ) : (
          <Field.HelperText>
            Provider-specific routing hints. Bedrock region, Azure
            deployment override, etc.
          </Field.HelperText>
        )}
      </Field.Root>

      <Box
        width="full"
        borderTop="1px solid"
        borderColor="border.muted"
        paddingTop={2}
      >
        <SmallLabel>Health (read-only)</SmallLabel>
        <VStack align="start" gap={1} fontSize="xs" color="fg.muted">
          <Text>Status: {initial.healthStatus ?? "UNKNOWN"}</Text>
          <Text>Last checked: {formatDate(initial.lastHealthCheckAt)}</Text>
          <Text>Circuit opened: {formatDate(initial.circuitOpenedAt)}</Text>
          {initial.disabledAt && (
            <Text color="red.500">
              Disabled at: {formatDate(initial.disabledAt)}
            </Text>
          )}
        </VStack>
      </Box>

      <HStack width="full" justify="end">
        <Button
          size="sm"
          colorPalette="orange"
          loading={(updateAdvanced as any)?.isPending}
          onClick={handleSave}
        >
          Save Advanced
        </Button>
      </HStack>
    </VStack>
  );
}
