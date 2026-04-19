import {
  Badge,
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Switch,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";

export type CacheRuleFormState = {
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  matchVkId: string;
  matchVkPrefix: string;
  matchVkTagsCsv: string;
  matchPrincipalId: string;
  matchModel: string;
  matchMetadataKey: string;
  matchMetadataValue: string;
  actionMode: "respect" | "force" | "disable";
  actionTtlSeconds: string;
  actionSalt: string;
};

export function emptyFormState(): CacheRuleFormState {
  return {
    name: "",
    description: "",
    priority: 100,
    enabled: true,
    matchVkId: "",
    matchVkPrefix: "",
    matchVkTagsCsv: "",
    matchPrincipalId: "",
    matchModel: "",
    matchMetadataKey: "",
    matchMetadataValue: "",
    actionMode: "respect",
    actionTtlSeconds: "",
    actionSalt: "",
  };
}

export function validateForm(state: CacheRuleFormState): string | null {
  if (!state.name.trim()) return "Name is required";
  if (state.priority < 0 || state.priority > 1_000) {
    return "Priority must be between 0 and 1000";
  }
  if (state.actionMode === "force" && state.actionTtlSeconds.trim()) {
    const n = Number(state.actionTtlSeconds);
    if (!Number.isFinite(n) || n < 0 || n > 86_400) {
      return "TTL must be a number between 0 and 86400 seconds";
    }
  }
  const metaKeyEmpty = !state.matchMetadataKey.trim();
  const metaValEmpty = !state.matchMetadataValue.trim();
  if (metaKeyEmpty !== metaValEmpty) {
    return "Request metadata needs both a key and a value";
  }
  if (
    !state.matchVkId &&
    !state.matchVkPrefix &&
    !state.matchVkTagsCsv.trim() &&
    !state.matchPrincipalId &&
    !state.matchModel &&
    !state.matchMetadataKey
  ) {
    return "At least one matcher is required (rules matching 'every request' must be explicit — not supported in v1)";
  }
  return null;
}

export function toWire(state: CacheRuleFormState): {
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: Record<string, unknown>;
  action: { mode: "respect" | "force" | "disable"; ttl?: number; salt?: string };
} {
  const matchers: Record<string, unknown> = {};
  if (state.matchVkId.trim()) matchers.vk_id = state.matchVkId.trim();
  if (state.matchVkPrefix.trim())
    matchers.vk_prefix = state.matchVkPrefix.trim();
  if (state.matchVkTagsCsv.trim()) {
    matchers.vk_tags = state.matchVkTagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (state.matchPrincipalId.trim())
    matchers.principal_id = state.matchPrincipalId.trim();
  if (state.matchModel.trim()) matchers.model = state.matchModel.trim();
  if (state.matchMetadataKey.trim() && state.matchMetadataValue.trim()) {
    matchers.request_metadata = {
      [state.matchMetadataKey.trim()]: state.matchMetadataValue.trim(),
    };
  }

  const action: {
    mode: "respect" | "force" | "disable";
    ttl?: number;
    salt?: string;
  } = { mode: state.actionMode };
  if (state.actionMode === "force" && state.actionTtlSeconds.trim()) {
    action.ttl = Number(state.actionTtlSeconds);
  }
  if (state.actionSalt.trim()) action.salt = state.actionSalt.trim();

  return {
    name: state.name.trim(),
    description: state.description.trim() || null,
    priority: state.priority,
    enabled: state.enabled,
    matchers,
    action,
  };
}

export function fromWire(rule: {
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: unknown;
  action: unknown;
}): CacheRuleFormState {
  const m = (rule.matchers ?? {}) as Record<string, unknown>;
  const a = (rule.action ?? {}) as Record<string, unknown>;
  const metadataObj =
    m.request_metadata && typeof m.request_metadata === "object"
      ? (m.request_metadata as Record<string, string>)
      : {};
  const firstMetadataKey = Object.keys(metadataObj)[0] ?? "";
  return {
    name: rule.name,
    description: rule.description ?? "",
    priority: rule.priority,
    enabled: rule.enabled,
    matchVkId: typeof m.vk_id === "string" ? m.vk_id : "",
    matchVkPrefix: typeof m.vk_prefix === "string" ? m.vk_prefix : "",
    matchVkTagsCsv: Array.isArray(m.vk_tags) ? m.vk_tags.join(",") : "",
    matchPrincipalId:
      typeof m.principal_id === "string" ? m.principal_id : "",
    matchModel: typeof m.model === "string" ? m.model : "",
    matchMetadataKey: firstMetadataKey,
    matchMetadataValue: firstMetadataKey ? metadataObj[firstMetadataKey] ?? "" : "",
    actionMode:
      a.mode === "force" || a.mode === "disable" || a.mode === "respect"
        ? a.mode
        : "respect",
    actionTtlSeconds: typeof a.ttl === "number" ? String(a.ttl) : "",
    actionSalt: typeof a.salt === "string" ? a.salt : "",
  };
}

type FormProps = {
  state: CacheRuleFormState;
  onChange: (state: CacheRuleFormState) => void;
};

export function CacheRuleForm({ state, onChange }: FormProps) {
  const set = <K extends keyof CacheRuleFormState>(
    key: K,
    value: CacheRuleFormState[K],
  ) => onChange({ ...state, [key]: value });

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input
          value={state.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. force-cache-on-enterprise"
          maxLength={128}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Textarea
          value={state.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Optional. Shown in the list and audit log."
          maxLength={512}
        />
      </Field.Root>
      <HStack align="start" gap={4}>
        <Field.Root>
          <Field.Label>Priority</Field.Label>
          <Input
            type="number"
            min={0}
            max={1000}
            value={state.priority}
            onChange={(e) =>
              set("priority", Number(e.target.value) || 0)
            }
          />
          <Field.HelperText>
            Evaluated highest-first. Conflicting rules: higher number wins.
          </Field.HelperText>
        </Field.Root>
        <Field.Root>
          <Field.Label>Enabled</Field.Label>
          <Switch.Root
            checked={state.enabled}
            onCheckedChange={(v) => set("enabled", v.checked)}
            colorPalette="orange"
          >
            <Switch.HiddenInput />
            <Switch.Control />
          </Switch.Root>
          <Field.HelperText>
            Disabled rules stay in the list but never match.
          </Field.HelperText>
        </Field.Root>
      </HStack>

      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="md"
        padding={4}
      >
        <HStack mb={3}>
          <Text fontSize="sm" fontWeight="semibold">
            Match when
          </Text>
          <Badge colorPalette="gray" fontSize="2xs">
            AND across non-empty fields
          </Badge>
        </HStack>
        <VStack align="stretch" gap={3}>
          <Field.Root>
            <Field.Label>Virtual key id (exact)</Field.Label>
            <Input
              value={state.matchVkId}
              onChange={(e) => set("matchVkId", e.target.value)}
              placeholder="vk_01HZX9K3M..."
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Virtual key display prefix (starts-with)</Field.Label>
            <Input
              value={state.matchVkPrefix}
              onChange={(e) => set("matchVkPrefix", e.target.value)}
              placeholder="lw_vk_live_"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Virtual key tags (comma-separated)</Field.Label>
            <Input
              value={state.matchVkTagsCsv}
              onChange={(e) => set("matchVkTagsCsv", e.target.value)}
              placeholder="tier=enterprise, team=ml"
            />
            <Field.HelperText>
              VK must carry ALL listed tags.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Principal (user id)</Field.Label>
            <Input
              value={state.matchPrincipalId}
              onChange={(e) => set("matchPrincipalId", e.target.value)}
              placeholder="user_01HZX..."
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Model</Field.Label>
            <Input
              value={state.matchModel}
              onChange={(e) => set("matchModel", e.target.value)}
              placeholder="e.g. gpt-5-mini or claude-3-5-sonnet-latest"
            />
          </Field.Root>
          <HStack align="start" gap={2}>
            <Field.Root>
              <Field.Label>Request metadata key</Field.Label>
              <Input
                value={state.matchMetadataKey}
                onChange={(e) => set("matchMetadataKey", e.target.value)}
                placeholder="X-Customer-Tier"
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Value</Field.Label>
              <Input
                value={state.matchMetadataValue}
                onChange={(e) => set("matchMetadataValue", e.target.value)}
                placeholder="enterprise"
              />
            </Field.Root>
          </HStack>
        </VStack>
      </Box>

      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="md"
        padding={4}
      >
        <Text fontSize="sm" fontWeight="semibold" mb={3}>
          Then do
        </Text>
        <VStack align="stretch" gap={3}>
          <Field.Root>
            <Field.Label>Cache control mode</Field.Label>
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={state.actionMode}
                onChange={(e) =>
                  set(
                    "actionMode",
                    e.target.value as "respect" | "force" | "disable",
                  )
                }
              >
                <option value="respect">respect — passthrough</option>
                <option value="force">force — cache where supported</option>
                <option value="disable">disable — strip cache hints</option>
              </NativeSelect.Field>
            </NativeSelect.Root>
            <Field.HelperText>
              Anthropic honours cache_control inject on force; OpenAI/Azure
              do automatic caching regardless; Gemini returns 400
              cache_override_not_implemented on force (v1 — see
              cache-control.mdx).
            </Field.HelperText>
          </Field.Root>
          {state.actionMode === "force" && (
            <Field.Root>
              <Field.Label>TTL (seconds, optional)</Field.Label>
              <Input
                type="number"
                min={0}
                max={86400}
                value={state.actionTtlSeconds}
                onChange={(e) => set("actionTtlSeconds", e.target.value)}
                placeholder="300"
              />
              <Field.HelperText>
                Clamped to [0, 86400]. Providers without explicit TTL
                support treat this as a best-effort hint.
              </Field.HelperText>
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>Cache salt (optional)</Field.Label>
            <Input
              value={state.actionSalt}
              onChange={(e) => set("actionSalt", e.target.value)}
              placeholder="e.g. 2026Q1-rerun — forces cache regeneration when changed"
              maxLength={64}
            />
          </Field.Root>
        </VStack>
      </Box>
    </VStack>
  );
}
