import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  buildScopeHierarchy,
  type OrgModelProvider,
  resolveEligible,
  type VirtualKeyScopeEntry,
} from "./eligibleModelProviders";
import { humanizeGatewayError } from "./gatewayErrorCopy";
import { resolveTracesHrefForKey } from "./tracesHrefForKey";
import {
  budgetInvalidReason,
  EMPTY_BUDGET,
  VirtualKeyBudgetSection,
  type VirtualKeyBudgetValue,
  type VirtualKeyBudgetWindow,
} from "./VirtualKeyBudgetSection";
import { VirtualKeyOwnershipReadOnly } from "./VirtualKeyOwnershipSection";
import {
  ALL_PROVIDERS,
  type ProviderAccessValue,
  providerAccessInvalidReason,
  providerAccessToConfig,
  VirtualKeyProviderAccessSection,
} from "./VirtualKeyProviderAccessSection";
import {
  routingValueFromKey,
  VirtualKeyRoutingSection,
  type VirtualKeyRoutingValue,
} from "./VirtualKeyRoutingSection";
import {
  parseTagsCsv,
  TAGS_CSV_MAX_LENGTH,
  tagsBeyondLimitsNotice,
  VK_TAGS_FIELD_DESCRIPTION,
} from "./virtualKeyTagsField";

type VirtualKeyDetail = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "revoked";
  scopes: VirtualKeyScopeEntry[];
  routingPolicyId: string | null;
  routingMode?: "NONE" | "FALLBACK_ALL" | "POLICY";
  traceProjectId?: string | null;
  /** True when the project the key traces into has been deleted. */
  traceProjectArchived?: boolean;
  principalUserId?: string | null;
  principalUser?: { name: string | null; email: string | null } | null;
  config: {
    // null / undefined = no allowlist = every eligible model is allowed.
    modelsAllowed?: string[] | null;
    // null / undefined = every provider in scope, current and future.
    providersAllowed?: string[] | null;
    cache?: { mode: "respect" | "force" | "disable"; ttlS: number };
    rateLimits?: {
      rpm: number | null;
      tpm: number | null;
      rpd: number | null;
    };
    realtime?: {
      maxOpenSessions: number | null;
    };
    metadata?: {
      label?: string;
      tags?: string[];
    };
  };
};

type VirtualKeyEditDrawerProps = {
  organizationId: string;
  vk: VirtualKeyDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const MANAGED_WINDOWS: ReadonlySet<string> = new Set(["DAY", "WEEK", "MONTH"]);

export function VirtualKeyEditDrawer({
  organizationId,
  vk,
  onOpenChange,
  onSaved,
}: VirtualKeyEditDrawerProps) {
  const { organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState<string>("");
  const [budget, setBudget] = useState<VirtualKeyBudgetValue>(EMPTY_BUDGET);
  const [budgetLoaded, setBudgetLoaded] = useState(false);
  const [isBudgetDirty, setIsBudgetDirty] = useState(false);
  const [hadManagedBudget, setHadManagedBudget] = useState(false);
  const [providerAccess, setProviderAccess] =
    useState<ProviderAccessValue>(ALL_PROVIDERS);
  const [routing, setRouting] = useState<VirtualKeyRoutingValue>(
    routingValueFromKey({ routingMode: "NONE", routingPolicyId: null }),
  );
  const [cacheMode, setCacheMode] = useState<"respect" | "force" | "disable">(
    "respect",
  );
  const [cacheTtlS, setCacheTtlS] = useState<number>(3600);
  const [rpm, setRpm] = useState<string>("");
  const [tpm, setTpm] = useState<string>("");
  const [rpd, setRpd] = useState<string>("");
  const [maxOpenSessions, setMaxOpenSessions] = useState<string>("");

  useEffect(() => {
    if (!vk) return;
    setName(vk.name);
    setDescription(vk.description ?? "");
    setTagsCsv((vk.config.metadata?.tags ?? []).join(", "));
    setCacheMode(vk.config.cache?.mode ?? "respect");
    setCacheTtlS(vk.config.cache?.ttlS ?? 3600);
    setRpm(vk.config.rateLimits?.rpm?.toString() ?? "");
    setTpm(vk.config.rateLimits?.tpm?.toString() ?? "");
    setRpd(vk.config.rateLimits?.rpd?.toString() ?? "");
    setMaxOpenSessions(vk.config.realtime?.maxOpenSessions?.toString() ?? "");
    const providersAllowed = vk.config.providersAllowed ?? null;
    setProviderAccess({
      allProviders: !providersAllowed || providersAllowed.length === 0,
      providerIds: providersAllowed ?? [],
      modelsAllowed: vk.config.modelsAllowed ?? [],
    });
    setRouting(
      routingValueFromKey({
        routingMode: vk.routingMode ?? null,
        routingPolicyId: vk.routingPolicyId,
      }),
    );
    setBudget(EMPTY_BUDGET);
    setBudgetLoaded(false);
    setIsBudgetDirty(false);
    setHadManagedBudget(false);
  }, [vk]);

  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
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
  const viewTracesHref = useMemo(
    () =>
      vk
        ? resolveTracesHrefForKey({
            teams: organization?.teams ?? [],
            virtualKeyId: vk.id,
            traceProjectId: vk.traceProjectId,
            traceProjectArchived: vk.traceProjectArchived,
          })
        : undefined,
    [vk, organization?.teams],
  );

  const utils = api.useUtils();
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!vk && !!organizationId },
  );
  const orgProvidersQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId },
      { enabled: !!vk && !!organizationId },
    );
  // The key's own budget, read from the same resolver that decides what
  // the gateway enforces. Seeds the budget field once per open.
  const applicableQuery = api.virtualKeys.applicableBudgets.useQuery(
    {
      organizationId,
      scopes: vk?.scopes ?? [],
      traceProjectId: vk?.traceProjectId ?? null,
      principalUserId: vk?.principalUserId ?? null,
      virtualKeyId: vk?.id ?? null,
    },
    { enabled: !!vk && !!organizationId && (vk?.scopes.length ?? 0) > 0 },
  );
  useEffect(() => {
    // The stored value seeds the field only while the person has not
    // typed: applicableBudgets resolves labels and ClickHouse spend, so
    // it can land AFTER an edit began, and seeding then would silently
    // replace what was typed with what was stored.
    if (!vk || budgetLoaded || isBudgetDirty || !applicableQuery.data) return;
    const own = applicableQuery.data.find(
      (b) => b.managedByVirtualKeyId === vk.id && MANAGED_WINDOWS.has(b.window),
    );
    if (own) {
      const limit = Number.parseFloat(own.limitUsd);
      setBudget({
        limitUsd: Number.isFinite(limit) ? String(limit) : own.limitUsd,
        window: own.window as VirtualKeyBudgetWindow,
      });
      setHadManagedBudget(true);
    }
    setBudgetLoaded(true);
  }, [vk, budgetLoaded, isBudgetDirty, applicableQuery.data]);

  const updateMutation = api.virtualKeys.update.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ organizationId });
      await utils.virtualKeys.applicableBudgets.invalidate();
    },
  });

  const providers = (orgProvidersQuery.data?.providers ??
    []) as OrgModelProvider[];
  const policies = (policiesQuery.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const eligible = useMemo(
    () =>
      resolveEligible(
        vk?.scopes ?? [],
        providers,
        buildScopeHierarchy(availableProjects, organizationId),
      ),
    [vk?.scopes, providers, availableProjects, organizationId],
  );

  const tagsNotice = tagsBeyondLimitsNotice(tagsCsv);

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const cannotSaveReason = (() => {
    if (!name) return "Name is required.";
    const budgetReason = budgetInvalidReason(budget);
    if (budgetReason) return budgetReason;
    // Until providers resolve, an explicit selection cannot be told
    // apart from an empty one, and submitting would filter the picked
    // ids against an empty eligible set and persist an empty allowlist.
    // Hold the save until the list is real.
    if (orgProvidersQuery.isLoading) {
      return "Loading providers…";
    }
    const providerReason = providerAccessInvalidReason(
      providerAccess,
      eligible,
    );
    if (providerReason) return providerReason;
    return null;
  })();

  const submit = async () => {
    if (!vk) return;
    if (cannotSaveReason) {
      toaster.create({ title: cannotSaveReason, type: "error" });
      return;
    }
    try {
      const access = providerAccessToConfig(providerAccess, eligible);
      const trimmedLimit = budget.limitUsd.trim();
      await updateMutation.mutateAsync({
        organizationId,
        id: vk.id,
        name,
        description: description || null,
        routingMode: routing.mode,
        routingPolicyId: routing.mode === "POLICY" ? routing.policyId : null,
        // Undefined leaves an absent budget alone; null archives one the
        // key had; a value creates or updates it.
        budget: trimmedLimit
          ? {
              limitUsd: trimmedLimit,
              window: budget.window,
            }
          : hadManagedBudget
            ? null
            : undefined,
        config: {
          providersAllowed: access.providersAllowed,
          modelsAllowed: access.modelsAllowed,
          cache: { mode: cacheMode, ttlS: cacheTtlS },
          rateLimits: {
            rpm: rpm ? Number.parseInt(rpm, 10) : null,
            tpm: tpm ? Number.parseInt(tpm, 10) : null,
            rpd: rpd ? Number.parseInt(rpd, 10) : null,
          },
          realtime: {
            maxOpenSessions: maxOpenSessions
              ? Number.parseInt(maxOpenSessions, 10)
              : null,
          },
          metadata: {
            tags: parseTagsCsv(tagsCsv),
          },
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title: humanizeGatewayError(error, "Failed to update virtual key"),
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
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>
                Name
                <FieldInfoTooltip
                  description="Human-readable identifier shown in the list and audit log. Must be unique within the organization. Rename is non-breaking: the VK id + secret remain the same."
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
                  description={VK_TAGS_FIELD_DESCRIPTION}
                  docHref="/ai-gateway/cache-control#cache-rules"
                  testId="vk-tags-info"
                />
              </Field.Label>
              <Input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="e.g. tier=enterprise, team=ml"
                maxLength={TAGS_CSV_MAX_LENGTH}
              />
              {tagsNotice && (
                <Field.HelperText color="orange.600">
                  {tagsNotice}
                </Field.HelperText>
              )}
            </Field.Root>

            {vk && (
              <>
                <Separator />
                <VirtualKeyOwnershipReadOnly
                  scopes={vk.scopes}
                  principal={
                    vk.principalUserId && vk.principalUser
                      ? vk.principalUser
                      : undefined
                  }
                  traceProjectId={vk.traceProjectId ?? null}
                  traceProjectArchived={vk.traceProjectArchived ?? false}
                  viewTracesHref={viewTracesHref}
                  ctx={{
                    organizationName: organization?.name,
                    availableTeams,
                    availableProjects,
                  }}
                />

                <Separator />
                <VirtualKeyBudgetSection
                  value={budget}
                  onChange={(next) => {
                    setIsBudgetDirty(true);
                    setBudget(next);
                  }}
                  organizationId={organizationId}
                  scopes={vk.scopes}
                  traceProjectId={vk.traceProjectId ?? null}
                  principalUserId={vk.principalUserId ?? null}
                  virtualKeyId={vk.id}
                />

                <Separator />
                <VirtualKeyProviderAccessSection
                  value={providerAccess}
                  onChange={setProviderAccess}
                  scopes={vk.scopes}
                  organizationId={organizationId}
                  organizationName={organization?.name}
                  availableTeams={availableTeams}
                  availableProjects={availableProjects}
                  providers={providers}
                  isLoading={orgProvidersQuery.isLoading}
                />

                <Separator />
                <VirtualKeyRoutingSection
                  value={routing}
                  onChange={setRouting}
                  policies={policies}
                />
              </>
            )}

            <Separator />
            <HStack>
              <Text fontSize="sm" fontWeight="semibold">
                Cache control
              </Text>
              <FieldInfoTooltip
                description="Per-VK default cache mode; the X-LangWatch-Cache request header and matching cache rules override per request. Provider-agnostic: Anthropic uses explicit cache_control markers, OpenAI/Azure cache prompts automatically, Gemini supports cachedContent references."
                docHref="/ai-gateway/cache-control"
              />
            </HStack>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>Mode</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={cacheMode}
                    onChange={(e) =>
                      setCacheMode(
                        (e.target.value as "respect" | "force" | "disable") ??
                          "respect",
                      )
                    }
                  >
                    <option value="respect">
                      Respect: pass provider cache directives through unchanged
                    </option>
                    <option value="disable">
                      Disable: strip cache directives before dispatch
                    </option>
                    <option value="force">
                      Force: inject cache_control on Anthropic (OpenAI auto,
                      Gemini WARN)
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
                Rate limits
              </Text>
              <FieldInfoTooltip
                description="Per-VK caps on the gateway hot path, blank = unlimited. Enforced in-memory on every gateway replica; on breach the gateway returns HTTP 429 with Retry-After and X-LangWatch-RateLimit-Dimension. Changes propagate to all replicas within ~60s."
                docHref="/ai-gateway/rate-limits"
              />
            </HStack>
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
                  <FieldInfoTooltip
                    description="Tokens / minute; requires pre-request token estimation and ships with Redis-coordinated cluster counters (v1.1)."
                    docHref="/ai-gateway/rate-limits"
                  />
                </Field.Label>
                <Input
                  value={tpm}
                  placeholder="deferred"
                  inputMode="numeric"
                  disabled
                />
                <Field.HelperText>Tokens / minute</Field.HelperText>
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
                Realtime voice
              </Text>
              <FieldInfoTooltip
                description="How many brokered voice sessions this key may hold open at once, blank = unlimited. The request limits above do not bound voice: one mint opens a call that bills for as long as it runs. A mint over the cap gets HTTP 429; a slot frees when the call ends."
                docHref="/ai-gateway/api/realtime"
              />
            </HStack>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>max open sessions</Field.Label>
                <Input
                  value={maxOpenSessions}
                  onChange={(e) => setMaxOpenSessions(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
                <Field.HelperText>
                  Concurrent realtime voice sessions
                </Field.HelperText>
              </Field.Root>
            </HStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            {cannotSaveReason && (
              <Text fontSize="xs" color="fg.muted">
                {cannotSaveReason}
              </Text>
            )}
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
              disabled={!!cannotSaveReason}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
