import {
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
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { EligibleModelProvidersPreview } from "./EligibleModelProvidersPreview";
import { FieldInfoTooltip } from "./FieldInfoTooltip";
import {
  VirtualKeyScopePicker,
  type VirtualKeyScopeEntry,
} from "./VirtualKeyScopePicker";

type PolicyRuleDimension = { deny: string[]; allow: string[] | null };

type GuardrailRef = { id: string; evaluator: string };

type VirtualKeyDetail = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  status: "active" | "revoked";
  scopes: VirtualKeyScopeEntry[];
  routingPolicyId: string | null;
  config: {
    modelAliases?: Record<string, string>;
    cache?: { mode: "respect" | "force" | "disable"; ttlS: number };
    rateLimits?: {
      rpm: number | null;
      tpm: number | null;
      rpd: number | null;
    };
    policyRules?: {
      tools?: PolicyRuleDimension;
      mcp?: PolicyRuleDimension;
      urls?: PolicyRuleDimension;
      models?: PolicyRuleDimension;
    };
    guardrails?: {
      pre?: GuardrailRef[];
      post?: GuardrailRef[];
      streamChunk?: GuardrailRef[];
      requestFailOpen?: boolean;
      responseFailOpen?: boolean;
    };
    metadata?: {
      label?: string;
      tags?: string[];
    };
  };
};

type GuardrailDirection = "pre" | "post" | "streamChunk";

const GUARDRAIL_DIRECTION_META: Record<
  GuardrailDirection,
  { label: string; description: string }
> = {
  pre: {
    label: "Request (pre)",
    description:
      "Runs on inbound request body. Block → 403 guardrail_blocked before any provider call. Fail-closed by default (503 guardrail_upstream_unavailable); toggle fail-open below to allow on evaluator timeout.",
  },
  post: {
    label: "Response (post)",
    description:
      "Runs on assistant text before the client sees it. Block → 403 + zero-cost debit. Modify → in-place redaction. Fail-closed by default.",
  },
  streamChunk: {
    label: "Stream chunk",
    description:
      "Runs per visible delta on SSE responses (role-only/tool-call/usage frames skip). Block → terminal SSE event:error with code=stream_chunk_blocked. Timeout/error always fail-open per contract (50ms budget).",
  },
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
  organizationId: string;
  projectId?: string;
  vk: VirtualKeyDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type AliasPair = { from: string; to: string };

export function VirtualKeyEditDrawer({
  organizationId,
  projectId,
  vk,
  onOpenChange,
  onSaved,
}: VirtualKeyEditDrawerProps) {
  const { organization, team, project } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [routingPolicyId, setRoutingPolicyId] = useState<string>("");
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
  const [tagsCsv, setTagsCsv] = useState<string>("");
  const [guardrails, setGuardrails] = useState<
    Record<GuardrailDirection, GuardrailRef[]>
  >({ pre: [], post: [], streamChunk: [] });
  const [requestFailOpen, setRequestFailOpen] = useState(false);
  const [responseFailOpen, setResponseFailOpen] = useState(false);

  useEffect(() => {
    if (!vk) return;
    setName(vk.name);
    setDescription(vk.description ?? "");
    setRoutingPolicyId(vk.routingPolicyId ?? "");
    setAliases(
      Object.entries(vk.config.modelAliases ?? {}).map(([from, to]) => ({
        from,
        to,
      })),
    );
    setCacheMode(vk.config.cache?.mode ?? "respect");
    setCacheTtlS(vk.config.cache?.ttlS ?? 3600);
    setTagsCsv((vk.config.metadata?.tags ?? []).join(", "));
    setRpm(vk.config.rateLimits?.rpm?.toString() ?? "");
    setTpm(vk.config.rateLimits?.tpm?.toString() ?? "");
    setRpd(vk.config.rateLimits?.rpd?.toString() ?? "");
    const bp = vk.config.policyRules ?? {};
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
    const gr = vk.config.guardrails ?? {};
    setGuardrails({
      pre: gr.pre ?? [],
      post: gr.post ?? [],
      streamChunk: gr.streamChunk ?? [],
    });
    setRequestFailOpen(gr.requestFailOpen ?? false);
    setResponseFailOpen(gr.responseFailOpen ?? false);
  }, [vk]);

  const availableTeams = useMemo(
    () =>
      organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () =>
      organization?.teams?.flatMap((t) =>
        t.projects.map((p) => ({
          id: p.id,
          name: `${p.name} · ${t.name}`,
          teamId: t.id,
        })),
      ) ?? [],
    [organization?.teams],
  );

  const parseLines = (value: string): string[] =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  const buildPolicyRules = () => {
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
  const monitorsQuery = api.monitors.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!vk && !!projectId },
  );
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!vk && !!organizationId },
  );
  const orgProvidersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId },
    { enabled: !!vk && !!organizationId },
  );
  const availableMonitors = useMemo(() => {
    return (monitorsQuery.data ?? [])
      .filter((m: any) => m.enabled && m.executionMode === "AS_GUARDRAIL")
      .map((m: any) => ({ id: m.id, evaluator: m.checkType, name: m.name }));
  }, [monitorsQuery.data]);
  const toggleGuardrail = (
    direction: GuardrailDirection,
    monitor: { id: string; evaluator: string },
  ) => {
    setGuardrails((prev) => {
      const existing = prev[direction];
      const present = existing.some((g) => g.id === monitor.id);
      return {
        ...prev,
        [direction]: present
          ? existing.filter((g) => g.id !== monitor.id)
          : [...existing, { id: monitor.id, evaluator: monitor.evaluator }],
      };
    });
  };
  const updateMutation = api.virtualKeys.update.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ organizationId });
    },
  });

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const addAlias = () => setAliases((a) => [...a, { from: "", to: "" }]);
  const removeAlias = (idx: number) =>
    setAliases((a) => a.filter((_, i) => i !== idx));
  const updateAlias = (idx: number, field: "from" | "to", value: string) => {
    setAliases((a) =>
      a.map((p, i) => (i === idx ? { ...p, [field]: value } : p)),
    );
  };

  const submit = async () => {
    if (!vk) return;
    if (!name) {
      toaster.create({ title: "Name is required", type: "error" });
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
        organizationId,
        id: vk.id,
        name,
        description: description || null,
        routingPolicyId: routingPolicyId ? routingPolicyId : null,
        config: {
          modelAliases,
          cache: { mode: cacheMode, ttlS: cacheTtlS },
          rateLimits: {
            rpm: rpm ? Number.parseInt(rpm, 10) : null,
            tpm: tpm ? Number.parseInt(tpm, 10) : null,
            rpd: rpd ? Number.parseInt(rpd, 10) : null,
          },
          policyRules: buildPolicyRules(),
          guardrails: {
            pre: guardrails.pre,
            post: guardrails.post,
            streamChunk: guardrails.streamChunk,
            requestFailOpen,
            responseFailOpen,
          },
          metadata: {
            tags: tagsCsv
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
          },
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : "Failed to update virtual key",
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root
      open={!!vk}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Edit virtual key</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <Field.Root required>
              <Field.Label>
                Name
                <FieldInfoTooltip
                  description="Human-readable identifier shown in the list and audit log. Must be unique within the organization. Rename is non-breaking — the VK id + secret remain the same."
                  docHref="/ai-gateway/virtual-keys#creating-a-vk"
                />
              </Field.Label>
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
            <Field.Root>
              <Field.Label>
                Tags
                <FieldInfoTooltip
                  description="Comma-separated tags attached to this VK. Cache-control rules match VKs on tags using AND-subset semantics — a rule matcher of ['tier=enterprise'] fires for any VK carrying that tag."
                  docHref="/ai-gateway/cache-control#cache-rules"
                />
              </Field.Label>
              <Input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="e.g. tier=enterprise, team=ml"
              />
              <Field.HelperText>
                Comma-separated. Cache-control rules can match on{" "}
                <code>vk_tags</code> as AND-subset, so rule matchers of{" "}
                <code>["tier=enterprise"]</code> fire for any VK carrying that
                tag.
              </Field.HelperText>
            </Field.Root>

            <Separator />
            {vk && (
              <VirtualKeyScopePicker
                scopes={vk.scopes}
                onScopesChange={() => undefined}
                isExisting
                organizationId={organizationId}
                organizationName={organization?.name}
                teamId={team?.id}
                teamName={team?.name}
                projectId={project?.id}
                projectName={project?.name}
                availableTeams={availableTeams}
                availableProjects={availableProjects}
              />
            )}

            <Field.Root>
              <Field.Label>
                Routing policy
                <FieldInfoTooltip
                  description="Force this VK to use a specific ordered set of ModelProviders instead of the scope-cascade fallback. Change is non-breaking — clients keep working with the new policy on the next /config refresh."
                  docHref="/ai-gateway/routing-policies"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={routingPolicyId}
                  onChange={(e) => setRoutingPolicyId(e.target.value)}
                >
                  <option value="">
                    Default — fall back to all eligible providers
                  </option>
                  {(policiesQuery.data ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Default cascade uses all eligible providers in fallback
                priority. Picking a policy constrains routing to its ordered
                provider list.
              </Field.HelperText>
            </Field.Root>

            <Box>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={1.5}>
                Eligible model providers
              </Text>
              <EligibleModelProvidersPreview
                scopes={vk?.scopes ?? []}
                organizationId={organizationId}
                organizationName={organization?.name}
                availableTeams={availableTeams}
                availableProjects={availableProjects}
                isLoading={orgProvidersQuery.isLoading}
                providers={(orgProvidersQuery.data?.providers ?? []) as any}
              />
            </Box>

            <Separator />
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Model aliases
              </Text>
              <FieldInfoTooltip
                description="Rewrite the model name a client requests before it reaches the provider. Useful for mapping 'gpt-4o' → 'gpt-4o-mini' for cost control, or fanning one logical model across providers."
                docHref="/ai-gateway/model-aliases"
              />
            </HStack>
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
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Cache control
              </Text>
              <FieldInfoTooltip
                description="Per-VK default cache mode. Per-request X-LangWatch-Cache header + matching cache rules override. See the doc for the 3-layer precedence model and per-provider semantics."
                docHref="/ai-gateway/cache-control"
              />
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              Provider-agnostic: Anthropic uses explicit cache_control
              markers, OpenAI/Azure cache prompts automatically, Gemini
              supports cachedContent references. Mode here applies to every
              provider this VK routes to; the X-LangWatch-Cache request
              header lets callers override per-request.
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
                      Respect — pass provider cache directives through unchanged
                    </option>
                    <option value="disable">
                      Disable — strip cache directives before dispatch
                    </option>
                    <option value="force">
                      Force — inject cache_control on Anthropic (OpenAI auto, Gemini WARN)
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
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Rate limits (blank = unlimited)
              </Text>
              <FieldInfoTooltip
                description="Per-VK rpm/rpd on the gateway hot path. Independent of per-binding rate limits — whichever trips first blocks. TPM is v1.1 (requires token estimation + Redis cluster counters)."
                docHref="/ai-gateway/rate-limits"
              />
            </HStack>
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
                  tpm
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
                  ships with Redis-coordinated cluster counters (v1.1).
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
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Policy rules
              </Text>
              <FieldInfoTooltip
                description="RE2 regex deny/allow lists across 4 dimensions: tools, MCP servers, URLs, models. Enforced pre-dispatch (zero provider cost). Deny wins."
                docHref="/ai-gateway/policy-rules"
              />
            </HStack>
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

            <Separator />
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Guardrails
              </Text>
              <FieldInfoTooltip
                description="Attach LangWatch evaluators as pre (request) / post (response) / stream_chunk hooks. Fail-closed by default; per-direction fail-open opt-in. stream_chunk is always fail-open-with-metric by contract."
                docHref="/ai-gateway/guardrails"
              />
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              Attach project-level guardrail monitors (marked "as guardrail"
              in Evaluations) to run on each direction. Fan-out is parallel
              with first-block short-circuit.
            </Text>
            {availableMonitors.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No guardrail monitors configured. Create one in{" "}
                <strong>Evaluations</strong> with execution mode{" "}
                <Code fontSize="xs">AS_GUARDRAIL</Code> to attach it here.
              </Text>
            ) : (
              (["pre", "post", "streamChunk"] as GuardrailDirection[]).map(
                (direction) => (
                  <Box key={direction}>
                    <Text fontSize="sm" fontWeight="medium" mb={1}>
                      {GUARDRAIL_DIRECTION_META[direction].label}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" mb={2}>
                      {GUARDRAIL_DIRECTION_META[direction].description}
                    </Text>
                    <VStack align="stretch" gap={1}>
                      {availableMonitors.map((monitor) => {
                        const selected = guardrails[direction].some(
                          (g) => g.id === monitor.id,
                        );
                        return (
                          <HStack
                            key={monitor.id}
                            border="1px solid"
                            borderColor={
                              selected ? "orange.400" : "border.subtle"
                            }
                            borderRadius="md"
                            paddingX={3}
                            paddingY={2}
                            cursor="pointer"
                            onClick={() => toggleGuardrail(direction, monitor)}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              readOnly
                            />
                            <VStack align="start" gap={0}>
                              <Text fontSize="sm" fontWeight="medium">
                                {monitor.name}
                              </Text>
                              <Text fontSize="xs" color="fg.muted">
                                <Code fontSize="2xs">{monitor.evaluator}</Code>
                              </Text>
                            </VStack>
                          </HStack>
                        );
                      })}
                    </VStack>
                  </Box>
                ),
              )
            )}
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <HStack>
                  <input
                    type="checkbox"
                    id="vk-request-fail-open"
                    checked={requestFailOpen}
                    onChange={(e) => setRequestFailOpen(e.target.checked)}
                  />
                  <label htmlFor="vk-request-fail-open">
                    <Text fontSize="sm">Allow request on evaluator error</Text>
                  </label>
                </HStack>
                <Field.HelperText>
                  Default: block. Enable to treat evaluator timeout/upstream
                  error as allow-with-warn-log on the pre direction.
                </Field.HelperText>
              </Field.Root>
              <Field.Root flex={1}>
                <HStack>
                  <input
                    type="checkbox"
                    id="vk-response-fail-open"
                    checked={responseFailOpen}
                    onChange={(e) => setResponseFailOpen(e.target.checked)}
                  />
                  <label htmlFor="vk-response-fail-open">
                    <Text fontSize="sm">Allow response on evaluator error</Text>
                  </label>
                </HStack>
                <Field.HelperText>
                  Same semantic for the post direction. stream_chunk is always
                  fail-open per contract (50ms budget).
                </Field.HelperText>
              </Field.Root>
            </HStack>
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
              disabled={!name}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
