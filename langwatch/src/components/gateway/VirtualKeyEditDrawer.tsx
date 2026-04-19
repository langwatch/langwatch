import {
  Badge,
  Box,
  Button,
  Code,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type BlockedPattern = { deny: string[]; allow: string[] | null };

type VirtualKeyDetail = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  providerCredentialIds: string[];
  config: {
    modelAliases?: Record<string, string>;
    cache?: { mode: "respect" | "force" | "disable"; ttlS: number };
    rateLimits?: {
      rpm: number | null;
      tpm: number | null;
      rpd: number | null;
    };
    blockedPatterns?: {
      tools?: BlockedPattern;
      mcp?: BlockedPattern;
      urls?: BlockedPattern;
      models?: BlockedPattern;
    };
  };
};

type Dimension = "tools" | "mcp" | "urls" | "models";

const DIMENSION_META: Record<
  Dimension,
  { label: string; placeholderDeny: string; helper: string }
> = {
  tools: {
    label: "Tools",
    placeholderDeny: "e.g. ^shell_.*\ndelete_user",
    helper:
      "RE2 regexes matched against OpenAI tools[].function.name + Anthropic tools[].name. Deny wins.",
  },
  mcp: {
    label: "MCP servers",
    placeholderDeny: "e.g. unapproved\\.example\\.com",
    helper:
      "Matched against mcp_servers[].name and .url. Deny wins; applies before dispatch.",
  },
  urls: {
    label: "URLs",
    placeholderDeny: "e.g. internal\\.corp\\..*",
    helper:
      "Extracted from the raw request body (user messages, tool args, system prompts). First deny match → 403 url_not_allowed.",
  },
  models: {
    label: "Models (policy)",
    placeholderDeny: "e.g. gpt-4o-search.*",
    helper:
      "RE2 regex policy distinct from the glob `modelsAllowed` allowlist above. Use this to enforce company policy (e.g. no non-deterministic models).",
  },
};

type VirtualKeyEditDrawerProps = {
  projectId: string;
  vk: VirtualKeyDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type AliasPair = { from: string; to: string };

export function VirtualKeyEditDrawer({
  projectId,
  vk,
  onOpenChange,
  onSaved,
}: VirtualKeyEditDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [aliases, setAliases] = useState<AliasPair[]>([]);
  const [cacheMode, setCacheMode] =
    useState<"respect" | "force" | "disable">("respect");
  const [cacheTtlS, setCacheTtlS] = useState<number>(3600);
  const [rpm, setRpm] = useState<string>("");
  const [tpm, setTpm] = useState<string>("");
  const [rpd, setRpd] = useState<string>("");
  const [blocked, setBlocked] = useState<
    Record<Dimension, { deny: string; allow: string }>
  >({
    tools: { deny: "", allow: "" },
    mcp: { deny: "", allow: "" },
    urls: { deny: "", allow: "" },
    models: { deny: "", allow: "" },
  });

  useEffect(() => {
    if (!vk) return;
    setName(vk.name);
    setDescription(vk.description ?? "");
    setProviderIds(vk.providerCredentialIds);
    setAliases(
      Object.entries(vk.config.modelAliases ?? {}).map(([from, to]) => ({
        from,
        to,
      })),
    );
    setCacheMode(vk.config.cache?.mode ?? "respect");
    setCacheTtlS(vk.config.cache?.ttlS ?? 3600);
    setRpm(vk.config.rateLimits?.rpm?.toString() ?? "");
    setTpm(vk.config.rateLimits?.tpm?.toString() ?? "");
    setRpd(vk.config.rateLimits?.rpd?.toString() ?? "");
    const bp = vk.config.blockedPatterns ?? {};
    setBlocked({
      tools: {
        deny: (bp.tools?.deny ?? []).join("\n"),
        allow: (bp.tools?.allow ?? []).join("\n"),
      },
      mcp: {
        deny: (bp.mcp?.deny ?? []).join("\n"),
        allow: (bp.mcp?.allow ?? []).join("\n"),
      },
      urls: {
        deny: (bp.urls?.deny ?? []).join("\n"),
        allow: (bp.urls?.allow ?? []).join("\n"),
      },
      models: {
        deny: (bp.models?.deny ?? []).join("\n"),
        allow: (bp.models?.allow ?? []).join("\n"),
      },
    });
  }, [vk]);

  const parseLines = (value: string): string[] =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  const buildBlockedPatterns = () => {
    const result: Record<
      Dimension,
      { deny: string[]; allow: string[] | null }
    > = {} as Record<Dimension, { deny: string[]; allow: string[] | null }>;
    for (const dim of ["tools", "mcp", "urls", "models"] as Dimension[]) {
      const deny = parseLines(blocked[dim].deny);
      const allowLines = parseLines(blocked[dim].allow);
      result[dim] = {
        deny,
        allow: allowLines.length > 0 ? allowLines : null,
      };
    }
    return result;
  };

  const utils = api.useContext();
  const credentialsQuery = api.gatewayProviders.list.useQuery(
    { projectId },
    { enabled: !!vk && !!projectId },
  );
  const updateMutation = api.virtualKeys.update.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ projectId });
    },
  });

  const availableProviders = useMemo(
    () => credentialsQuery.data ?? [],
    [credentialsQuery.data],
  );

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const moveProvider = (index: number, delta: -1 | 1) => {
    setProviderIds((ids) => {
      const next = [...ids];
      const target = index + delta;
      if (target < 0 || target >= next.length) return ids;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const removeProvider = (index: number) => {
    setProviderIds((ids) => ids.filter((_, i) => i !== index));
  };

  const addProvider = (id: string) => {
    if (!id || providerIds.includes(id)) return;
    setProviderIds((ids) => [...ids, id]);
  };

  const addAlias = () => setAliases((a) => [...a, { from: "", to: "" }]);
  const removeAlias = (idx: number) =>
    setAliases((a) => a.filter((_, i) => i !== idx));
  const updateAlias = (idx: number, field: "from" | "to", value: string) => {
    setAliases((a) => a.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const submit = async () => {
    if (!vk) return;
    if (!name) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    if (providerIds.length === 0) {
      toaster.create({
        title: "At least one provider is required",
        type: "error",
      });
      return;
    }
    const modelAliases: Record<string, string> = {};
    for (const pair of aliases) {
      if (pair.from.trim() && pair.to.trim()) {
        modelAliases[pair.from.trim()] = pair.to.trim();
      }
    }
    try {
      await updateMutation.mutateAsync({
        projectId: vk.projectId,
        id: vk.id,
        name,
        description: description || null,
        providerCredentialIds: providerIds,
        config: {
          modelAliases,
          cache: { mode: cacheMode, ttlS: cacheTtlS },
          rateLimits: {
            rpm: rpm ? Number.parseInt(rpm, 10) : null,
            tpm: tpm ? Number.parseInt(tpm, 10) : null,
            rpd: rpd ? Number.parseInt(rpd, 10) : null,
          },
          blockedPatterns: buildBlockedPatterns(),
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "Failed to update virtual key",
        type: "error",
      });
    }
  };

  const providerNameById = new Map(
    availableProviders.map((p: any) => [
      p.id,
      p.modelProviderName ?? p.provider ?? p.id,
    ]),
  );
  const unselectedProviders = availableProviders.filter(
    (p: any) => !providerIds.includes(p.id),
  );

  return (
    <Drawer.Root
      open={!!vk}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>Edit virtual key</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={updateMutation.isPending}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field.Root>

            <Separator />
            <Text fontSize="sm" fontWeight="semibold">
              Provider fallback chain
            </Text>
            <VStack align="stretch" gap={2}>
              {providerIds.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  No providers selected. Add at least one.
                </Text>
              ) : (
                providerIds.map((id, idx) => (
                  <HStack
                    key={id}
                    border="1px solid"
                    borderColor="border.subtle"
                    borderRadius="md"
                    paddingX={3}
                    paddingY={2}
                  >
                    <Badge colorPalette="orange">#{idx + 1}</Badge>
                    <Text fontSize="sm">
                      {providerNameById.get(id) ?? id}
                    </Text>
                    <Spacer />
                    <IconButton
                      aria-label="Move up"
                      variant="ghost"
                      size="xs"
                      onClick={() => moveProvider(idx, -1)}
                      disabled={idx === 0}
                    >
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton
                      aria-label="Move down"
                      variant="ghost"
                      size="xs"
                      onClick={() => moveProvider(idx, 1)}
                      disabled={idx === providerIds.length - 1}
                    >
                      <ArrowDown size={12} />
                    </IconButton>
                    <IconButton
                      aria-label="Remove"
                      variant="ghost"
                      size="xs"
                      onClick={() => removeProvider(idx)}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </HStack>
                ))
              )}
              {unselectedProviders.length > 0 && (
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value=""
                    onChange={(e) => addProvider(e.target.value)}
                  >
                    <option value="">+ Add provider to chain…</option>
                    {unselectedProviders.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.modelProviderName ?? p.provider ?? p.id}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              )}
            </VStack>

            <Separator />
            <Text fontSize="sm" fontWeight="semibold">
              Model aliases
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Rewrite the model name a client requests before it reaches the
              provider. Useful to map "gpt-4o" → "gpt-4o-mini" for cost control,
              or to fan one logical model across providers.
            </Text>
            <VStack align="stretch" gap={2}>
              {aliases.map((pair, idx) => (
                <HStack key={idx}>
                  <Input
                    placeholder="from (e.g. gpt-4o)"
                    size="sm"
                    value={pair.from}
                    onChange={(e) => updateAlias(idx, "from", e.target.value)}
                  />
                  <Text>→</Text>
                  <Input
                    placeholder="to (e.g. gpt-4o-mini)"
                    size="sm"
                    value={pair.to}
                    onChange={(e) => updateAlias(idx, "to", e.target.value)}
                  />
                  <IconButton
                    aria-label="Remove alias"
                    variant="ghost"
                    size="xs"
                    onClick={() => removeAlias(idx)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </HStack>
              ))}
              <Button size="xs" variant="outline" onClick={addAlias}>
                <Plus size={12} /> Add alias
              </Button>
            </VStack>

            <Separator />
            <Text fontSize="sm" fontWeight="semibold">
              Cache
            </Text>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>Mode</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={cacheMode}
                    onChange={(e) =>
                      setCacheMode(
                        (e.target.value as
                          | "respect"
                          | "force"
                          | "disable") ?? "respect",
                      )
                    }
                  >
                    <option value="respect">
                      Respect — honour provider caching headers
                    </option>
                    <option value="force">
                      Force — cache even when provider says no
                    </option>
                    <option value="disable">
                      Disable — skip cache entirely
                    </option>
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>TTL (seconds)</Field.Label>
                <Input
                  value={cacheTtlS.toString()}
                  onChange={(e) =>
                    setCacheTtlS(
                      Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                    )
                  }
                  inputMode="numeric"
                />
              </Field.Root>
            </HStack>

            <Separator />
            <Text fontSize="sm" fontWeight="semibold">
              Rate limits (blank = unlimited)
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Enforced per-VK in-memory on every gateway replica. On breach the
              gateway returns HTTP 429 with <Code fontSize="xs">Retry-After</Code>{" "}
              and <Code fontSize="xs">X-LangWatch-RateLimit-Dimension</Code>.
              Changes propagate to all replicas within ~60s.
            </Text>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>rpm</Field.Label>
                <Input
                  value={rpm}
                  onChange={(e) => setRpm(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
                <Field.HelperText>Requests / minute</Field.HelperText>
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>
                  tpm{" "}
                  <Badge colorPalette="gray" fontSize="2xs" ml={1}>
                    v1.1
                  </Badge>
                </Field.Label>
                <Input
                  value={tpm}
                  onChange={(e) => setTpm(e.target.value)}
                  placeholder="deferred"
                  inputMode="numeric"
                  disabled
                />
                <Field.HelperText>
                  Tokens / minute — requires pre-request token estimation;
                  ships with Redis-coordinated cluster counters.
                </Field.HelperText>
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>rpd</Field.Label>
                <Input
                  value={rpd}
                  onChange={(e) => setRpd(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
                <Field.HelperText>Requests / day</Field.HelperText>
              </Field.Root>
            </HStack>

            <Separator />
            <Text fontSize="sm" fontWeight="semibold">
              Blocked patterns
            </Text>
            <Text fontSize="xs" color="fg.muted">
              RE2 regex deny/allow lists enforced on the gateway before the
              request reaches the provider. Deny wins across both lists.
              First-match rejection returns <Code fontSize="xs">403</Code> with
              code <Code fontSize="xs">tool_not_allowed</Code> /{" "}
              <Code fontSize="xs">mcp_not_allowed</Code> /{" "}
              <Code fontSize="xs">url_not_allowed</Code> /{" "}
              <Code fontSize="xs">model_not_allowed</Code>. One pattern per
              line. Broken regex → <Code fontSize="xs">503</Code> fail-closed
              (never silent bypass).
            </Text>
            {(["tools", "mcp", "urls", "models"] as Dimension[]).map((dim) => (
              <Box key={dim}>
                <HStack justify="space-between" mb={1}>
                  <Text fontSize="sm" fontWeight="medium">
                    {DIMENSION_META[dim].label}
                  </Text>
                </HStack>
                <Text fontSize="xs" color="fg.muted" mb={2}>
                  {DIMENSION_META[dim].helper}
                </Text>
                <HStack gap={3} align="flex-start">
                  <Field.Root flex={1}>
                    <Field.Label fontSize="xs">Deny</Field.Label>
                    <Textarea
                      value={blocked[dim].deny}
                      onChange={(e) =>
                        setBlocked((prev) => ({
                          ...prev,
                          [dim]: { ...prev[dim], deny: e.target.value },
                        }))
                      }
                      placeholder={DIMENSION_META[dim].placeholderDeny}
                      rows={3}
                      fontFamily="mono"
                      fontSize="xs"
                    />
                  </Field.Root>
                  <Field.Root flex={1}>
                    <Field.Label fontSize="xs">Allow (optional)</Field.Label>
                    <Textarea
                      value={blocked[dim].allow}
                      onChange={(e) =>
                        setBlocked((prev) => ({
                          ...prev,
                          [dim]: { ...prev[dim], allow: e.target.value },
                        }))
                      }
                      placeholder="leave blank = no allowlist"
                      rows={3}
                      fontFamily="mono"
                      fontSize="xs"
                    />
                  </Field.Root>
                </HStack>
              </Box>
            ))}

            <Box paddingTop={2}>
              <Text fontSize="xs" color="fg.muted">
                Advanced controls (guardrails, fallback triggers, principal
                binding) are editable via the REST/CLI until a dedicated tab
                lands.
              </Text>
            </Box>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={close}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={submit}
              loading={updateMutation.isPending}
              disabled={!name || providerIds.length === 0}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
