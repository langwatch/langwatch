import {
  Accordion,
  Box,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";

import { SmallLabel } from "../SmallLabel";

/**
 * Editable advanced (gateway) draft. The parent form owns this state so
 * the drawer's single Save persists basic + advanced together in one
 * `api.modelProvider.update` mutation.
 *
 * Numeric inputs stay as raw strings until submit time so half-typed
 * values do not get coerced to NaN mid-keystroke; the form converts
 * them to `number | null` on the way out.
 */
export interface ModelProviderAdvancedDraft {
  rateLimitRpm: string;
  rateLimitTpm: string;
  rateLimitRpd: string;
  fallbackPriorityGlobal: string;
  providerConfigJson: string;
}

export const EMPTY_ADVANCED_DRAFT: ModelProviderAdvancedDraft = {
  rateLimitRpm: "",
  rateLimitTpm: "",
  rateLimitRpd: "",
  fallbackPriorityGlobal: "",
  providerConfigJson: "",
};

export function intToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function inputToInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function jsonToInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

export function draftFromProvider(initial: {
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
  providerConfig: unknown;
}): ModelProviderAdvancedDraft {
  return {
    rateLimitRpm: intToInput(initial.rateLimitRpm),
    rateLimitTpm: intToInput(initial.rateLimitTpm),
    rateLimitRpd: intToInput(initial.rateLimitRpd),
    fallbackPriorityGlobal: intToInput(initial.fallbackPriorityGlobal),
    providerConfigJson: jsonToInput(initial.providerConfig),
  };
}

/**
 * Parsed advanced draft for the update payload. `providerConfig` of
 * `undefined` means "not parsed yet"; the caller treats that as "skip".
 * A throw means malformed JSON the form should refuse to submit.
 */
export interface ParsedAdvancedPayload {
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
  providerConfig: Record<string, unknown> | null;
}

export function parseAdvancedDraft(
  draft: ModelProviderAdvancedDraft,
): ParsedAdvancedPayload {
  let providerConfig: Record<string, unknown> | null = null;
  if (draft.providerConfigJson.trim()) {
    const parsed: unknown = JSON.parse(draft.providerConfigJson);
    // Reject valid-but-non-object JSON ([1,2], 42, "x", null) up front
    // so the user gets a clean inline error instead of the gateway zod
    // rejecting it with a cryptic "Expected object, received array".
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Provider config must be a JSON object");
    }
    providerConfig = parsed as Record<string, unknown>;
  }
  return {
    rateLimitRpm: inputToInt(draft.rateLimitRpm),
    rateLimitTpm: inputToInt(draft.rateLimitTpm),
    rateLimitRpd: inputToInt(draft.rateLimitRpd),
    fallbackPriorityGlobal: inputToInt(draft.fallbackPriorityGlobal),
    providerConfig,
  };
}

/**
 * Advanced (Gateway) accordion on the ModelProvider drawer. Collapsed by
 * default — the gateway-only knobs (rate limits, fallback priority,
 * provider config) sit out of sight on first setup, and only the
 * gateway audience expands them. Health/circuit state are read-only
 * below the editable fields when present.
 *
 * State is owned by the parent form; this component is pure UI. The
 * Save button at the bottom of the drawer persists basic + advanced in
 * a single `update` round-trip.
 */
export function ModelProviderAdvancedSection({
  modelProviderId,
  draft,
  onDraftChange,
  jsonError,
  initial,
  accordionValue,
  onAccordionValueChange,
}: {
  modelProviderId: string | undefined;
  draft: ModelProviderAdvancedDraft;
  onDraftChange: (next: ModelProviderAdvancedDraft) => void;
  jsonError: string | null;
  initial: {
    healthStatus?: string | null;
    circuitOpenedAt?: Date | string | null;
    lastHealthCheckAt?: Date | string | null;
    disabledAt?: Date | string | null;
  };
  /**
   * Controlled accordion expansion. Lifted so the parent form can
   * auto-expand on malformed JSON at Save time — otherwise the inline
   * `jsonError` renders inside collapsed content and the user gets no
   * feedback. `[]` = collapsed, `["advanced-gateway"]` = expanded.
   */
  accordionValue: string[];
  onAccordionValueChange: (value: string[]) => void;
}) {
  const setField =
    <K extends keyof ModelProviderAdvancedDraft>(key: K) =>
    (value: ModelProviderAdvancedDraft[K]) =>
      onDraftChange({ ...draft, [key]: value });

  const formatDate = (d: Date | string | null | undefined): string => {
    if (!d) return "—";
    const date = typeof d === "string" ? new Date(d) : d;
    return Number.isFinite(date.getTime())
      ? date.toLocaleString()
      : String(d);
  };

  return (
    <Accordion.Root
      collapsible
      width="full"
      value={accordionValue}
      onValueChange={(details) => onAccordionValueChange(details.value)}
    >
      <Accordion.Item value="advanced-gateway" width="full">
        <Accordion.ItemTrigger paddingY={2}>
          <HStack width="full" justify="space-between">
            <SmallLabel>Advanced (Gateway)</SmallLabel>
            <Accordion.ItemIndicator>
              <LuChevronDown />
            </Accordion.ItemIndicator>
          </HStack>
        </Accordion.ItemTrigger>
        <Accordion.ItemContent>
          {!modelProviderId ? (
            <Box width="full" paddingY={2}>
              <Text fontSize="xs" color="gray.500">
                Save the provider first to configure rate limits and
                routing hints.
              </Text>
            </Box>
          ) : (
            <VStack align="start" width="full" gap={3} paddingTop={2}>
              <HStack width="full" align="start" gap={3}>
                <Field.Root>
                  <SmallLabel>RPM</SmallLabel>
                  <Input
                    type="number"
                    min={0}
                    placeholder="No cap"
                    value={draft.rateLimitRpm}
                    onChange={(e) => setField("rateLimitRpm")(e.target.value)}
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
                    onChange={(e) => setField("rateLimitTpm")(e.target.value)}
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
                    onChange={(e) => setField("rateLimitRpd")(e.target.value)}
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
                    setField("fallbackPriorityGlobal")(e.target.value)
                  }
                />
                <Field.HelperText>
                  Order used when a Virtual Key has no Routing Policy.
                  Lower tries first. Tiebreak by creation order.
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
                    setField("providerConfigJson")(e.target.value)
                  }
                />
                {jsonError ? (
                  <Text fontSize="xs" color="red.500">
                    {jsonError}
                  </Text>
                ) : (
                  <Field.HelperText>
                    Provider-specific routing hints. Bedrock region,
                    Azure deployment override, etc.
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
                  <Text>
                    Last checked: {formatDate(initial.lastHealthCheckAt)}
                  </Text>
                  <Text>
                    Circuit opened: {formatDate(initial.circuitOpenedAt)}
                  </Text>
                  {initial.disabledAt && (
                    <Text color="red.500">
                      Disabled at: {formatDate(initial.disabledAt)}
                    </Text>
                  )}
                </VStack>
              </Box>
            </VStack>
          )}
        </Accordion.ItemContent>
      </Accordion.Item>
    </Accordion.Root>
  );
}
