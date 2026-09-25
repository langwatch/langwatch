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
import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import {
  defaultVirtualKeyConfig,
  type VirtualKeyApplicableBudgets,
  type VirtualKeyCamelDtoResponse,
  type VirtualKeyConfig,
  virtualKeyConfigSchema,
} from "@langwatch/gateway-contract";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../behavior/gateway-api.ts";
import { useGatewayToaster } from "../../../../behavior/gateway-feedback.ts";
import { useOrganizationTeamProject } from "../../../../behavior/gateway-session.ts";
import { humanizeGatewayError } from "../../../../model/gateway-error-copy.ts";
import type { GatewayTeam } from "../../../../model/gateway-host.ts";
import {
  buildScopeHierarchy,
  type OrgModelProvider,
  resolveEligible,
} from "../../model/eligible-model-providers.ts";
import { resolveTracesHrefForKey } from "../../model/traces-href-for-key.ts";
import {
  expirationStateFromStored,
  expiryFieldErrorFrom,
  expiryIncompleteReason,
  resolveExpiresAt,
} from "../../model/virtual-key-expiration.ts";
import {
  TAGS_CSV_MAX_LENGTH,
  VK_TAGS_FIELD_DESCRIPTION,
  parseTagsCsv,
  tagsBeyondLimitsNotice,
} from "../../model/virtual-key-tags-field.ts";
import { VirtualKeyOwnershipReadOnly } from "../blocks/virtual-key-ownership-section.tsx";
import {
  ALL_PROVIDERS,
  type ProviderAccessValue,
  providerAccessInvalidReason,
  providerAccessToConfig,
  VirtualKeyProviderAccessSection,
} from "../blocks/virtual-key-provider-access-section.tsx";
import {
  NEVER_EXPIRES,
  VirtualKeyExpirationSection,
  type VirtualKeyExpirationValue,
} from "../elements/virtual-key-expiration-section.tsx";
import {
  routingValueFromKey,
  VirtualKeyRoutingSection,
  type VirtualKeyRoutingValue,
} from "../elements/virtual-key-routing-section.tsx";
import {
  budgetInvalidReason,
  EMPTY_BUDGET,
  VirtualKeyBudgetSection,
  type VirtualKeyBudgetValue,
  type VirtualKeyBudgetWindow,
} from "./virtual-key-budget-section.tsx";

/** The key as the list and detail pages hold it: the wire leaves an unset `config` out. */
export type VirtualKeyDetail = Omit<VirtualKeyCamelDtoResponse, "config"> &
  Partial<Pick<VirtualKeyCamelDtoResponse, "config">>;

/** The stored config the form seeds from; a missing or unparseable one seeds the defaults. */
function storedConfig(raw: unknown): VirtualKeyConfig {
  const parsed = virtualKeyConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultVirtualKeyConfig();
}

type VirtualKeyEditDrawerProps = {
  organizationId: string;
  vk: VirtualKeyDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const MANAGED_WINDOWS: ReadonlySet<string> = new Set(["DAY", "WEEK", "MONTH"]);

/**
 * Validates that the open-session cap is a whole number of 1 or more.
 * Requires exact parsing to prevent typos from silently saving wrong values.
 */
function maxOpenSessionsInvalid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const parsed = Number(trimmed);
  return !Number.isInteger(parsed) || parsed < 1;
}

function availableProjectsOf(
  teams: readonly GatewayTeam[],
): { id: string; name: string; teamId: string }[] {
  return teams.flatMap((t) =>
    t.projects.map((p) => ({
      id: p.id,
      name: `${p.name} · ${t.name}`,
      teamId: t.id,
    })),
  );
}

function tracesHrefFor(input: {
  vk: VirtualKeyDetail | null;
  teams: readonly GatewayTeam[];
}): string | undefined {
  if (!input.vk) return undefined;
  return resolveTracesHrefForKey({
    teams: input.teams,
    virtualKeyId: input.vk.id,
    traceProjectId: input.vk.traceProjectId,
    traceProjectArchived: input.vk.traceProjectArchived,
  });
}

type ApplicableBudget = VirtualKeyApplicableBudgets[number];

/** The budget this key's own field manages, found by its linkage, as the field shows it. */
function ownManagedBudget(input: {
  applicable: readonly ApplicableBudget[];
  virtualKeyId: string;
}): VirtualKeyBudgetValue | undefined {
  const own = input.applicable.find(
    (b) => b.managedByVirtualKeyId === input.virtualKeyId && MANAGED_WINDOWS.has(b.window),
  );
  if (!own) return undefined;
  const limit = Number.parseFloat(own.limitUsd);
  return {
    limitUsd: Number.isFinite(limit) ? String(limit) : own.limitUsd,
    window: own.window as VirtualKeyBudgetWindow,
  };
}

/** The first thing that keeps the edit from being saved yet, in the order the form reads. */
function cannotSaveReasonFor(input: {
  name: string;
  budget: VirtualKeyBudgetValue;
  maxOpenSessions: string;
  providersLoading: boolean;
  providerAccess: ProviderAccessValue;
  eligible: ReturnType<typeof resolveEligible>;
  expiration: VirtualKeyExpirationValue;
  expiresAt: ReturnType<typeof resolveExpiresAt>;
}): ReturnType<typeof expiryIncompleteReason> | string {
  if (!input.name) return "Name is required.";
  const budgetReason = budgetInvalidReason(input.budget);
  if (budgetReason) return budgetReason;
  if (maxOpenSessionsInvalid(input.maxOpenSessions)) {
    return "Max open sessions must be a whole number of 1 or more, or blank for unlimited.";
  }
  // Until providers resolve, an explicit selection cannot be told
  // apart from an empty one, and submitting would filter the picked
  // ids against an empty eligible set and persist an empty allowlist.
  // Hold the save until the list is real.
  if (input.providersLoading) {
    return "Loading providers…";
  }
  const providerReason = providerAccessInvalidReason(input.providerAccess, input.eligible);
  if (providerReason) return providerReason;
  return expiryIncompleteReason({ preset: input.expiration.preset, expiresAt: input.expiresAt });
}

/**
 * An untouched expiry is omitted, leaving the stored date alone: sending it back would round it
 * to the end of its seeded day, and fail the future-date check on any edit to an expired key.
 */
function expiresAtPatchFor(input: {
  expiration: VirtualKeyExpirationValue;
  storedExpiresAt: string | null;
  expiresAt: ReturnType<typeof resolveExpiresAt>;
}): ReturnType<typeof resolveExpiresAt> | undefined {
  const seeded = expirationStateFromStored(input.storedExpiresAt);
  const untouched =
    input.expiration.preset === seeded.preset && input.expiration.customDate === seeded.customDate;
  return untouched ? undefined : input.expiresAt;
}

/** A rejected date belongs on the field the reader is still looking at; anything else toasts. */
function reportUpdateFailure(input: {
  error: unknown;
  onExpiryError: (message: string) => void;
  onFailure: (title: string) => void;
}): void {
  const expiryError = expiryFieldErrorFrom(input.error);
  if (expiryError) {
    input.onExpiryError(expiryError);
    return;
  }
  input.onFailure(humanizeGatewayError(input.error, "Failed to update virtual key"));
}

type UpdateVirtualKeyInput = Parameters<
  ReturnType<typeof api.virtualKeys.update.useMutation>["mutateAsync"]
>[0];

/** The form as the update call takes it; see the field notes for what absent and null mean. */
function updateVirtualKeyInput(form: {
  organizationId: string;
  id: string;
  name: string;
  description: string;
  routing: VirtualKeyRoutingValue;
  expiresAtPatch: ReturnType<typeof resolveExpiresAt> | undefined;
  budget: VirtualKeyBudgetValue;
  hadManagedBudget: boolean;
  access: ReturnType<typeof providerAccessToConfig>;
  cache: { mode: "respect" | "force" | "disable"; ttlS: number };
  rpm: string;
  tpm: string;
  rpd: string;
  maxOpenSessions: string;
  tagsCsv: string;
}): UpdateVirtualKeyInput {
  const trimmedLimit = form.budget.limitUsd.trim();
  const clearedBudget = form.hadManagedBudget ? null : undefined;
  return {
    organizationId: form.organizationId,
    id: form.id,
    name: form.name,
    description: form.description || null,
    routingMode: form.routing.mode,
    routingPolicyId: form.routing.mode === "POLICY" ? form.routing.policyId : null,
    // Absent leaves the stored date alone; null clears it ("Never"); a date moves it.
    ...(form.expiresAtPatch !== undefined ? { expiresAt: form.expiresAtPatch } : {}),
    // Undefined leaves an absent budget alone; null archives one the key had.
    budget: trimmedLimit ? { limitUsd: trimmedLimit, window: form.budget.window } : clearedBudget,
    config: {
      providersAllowed: form.access.providersAllowed,
      modelsAllowed: form.access.modelsAllowed,
      cache: form.cache,
      rateLimits: {
        rpm: form.rpm ? Number.parseInt(form.rpm, 10) : null,
        tpm: form.tpm ? Number.parseInt(form.tpm, 10) : null,
        rpd: form.rpd ? Number.parseInt(form.rpd, 10) : null,
      },
      realtime: {
        maxOpenSessions: form.maxOpenSessions.trim() ? Number(form.maxOpenSessions.trim()) : null,
      },
      metadata: {
        tags: parseTagsCsv(form.tagsCsv),
      },
    },
  };
}

type CacheMode = "respect" | "force" | "disable";

/** The key's own cache default, request rate limits and realtime session cap. */
function VirtualKeyLimitsFields({
  cacheMode,
  cacheTtlS,
  rpm,
  tpm,
  rpd,
  maxOpenSessions,
  onCacheModeChange,
  onCacheTtlSChange,
  onRpmChange,
  onRpdChange,
  onMaxOpenSessionsChange,
}: {
  cacheMode: CacheMode;
  cacheTtlS: number;
  rpm: string;
  tpm: string;
  rpd: string;
  maxOpenSessions: string;
  onCacheModeChange: (mode: CacheMode) => void;
  onCacheTtlSChange: (ttlS: number) => void;
  onRpmChange: (value: string) => void;
  onRpdChange: (value: string) => void;
  onMaxOpenSessionsChange: (value: string) => void;
}) {
  return (
    <>
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
                onCacheModeChange((e.target.value as "respect" | "force" | "disable") ?? "respect")
              }
            >
              <option value="respect">
                Respect: pass provider cache directives through unchanged
              </option>
              <option value="disable">Disable: strip cache directives before dispatch</option>
              <option value="force">
                Force: inject cache_control on Anthropic (OpenAI auto, Gemini WARN)
              </option>
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>
        <Field.Root flex={1}>
          <Field.Label>TTL (seconds)</Field.Label>
          <Input
            value={cacheTtlS.toString()}
            onChange={(e) =>
              onCacheTtlSChange(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
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
            onChange={(e) => onRpmChange(e.target.value)}
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
          <Input value={tpm} placeholder="deferred" inputMode="numeric" disabled />
          <Field.HelperText>Tokens / minute</Field.HelperText>
        </Field.Root>
        <Field.Root flex={1}>
          <Field.Label>rpd</Field.Label>
          <Input
            value={rpd}
            onChange={(e) => onRpdChange(e.target.value)}
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
            onChange={(e) => onMaxOpenSessionsChange(e.target.value)}
            placeholder="unlimited"
            inputMode="numeric"
          />
          <Field.HelperText>Concurrent realtime voice sessions</Field.HelperText>
        </Field.Root>
      </HStack>
    </>
  );
}

export function VirtualKeyEditDrawer({
  organizationId,
  vk,
  onOpenChange,
  onSaved,
}: VirtualKeyEditDrawerProps) {
  const toaster = useGatewayToaster();
  const { organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState<string>("");
  const [budget, setBudget] = useState<VirtualKeyBudgetValue>(EMPTY_BUDGET);
  const [budgetLoaded, setBudgetLoaded] = useState(false);
  const [isBudgetDirty, setIsBudgetDirty] = useState(false);
  const [hadManagedBudget, setHadManagedBudget] = useState(false);
  const [providerAccess, setProviderAccess] = useState<ProviderAccessValue>(ALL_PROVIDERS);
  const [routing, setRouting] = useState<VirtualKeyRoutingValue>(
    routingValueFromKey({ routingMode: "NONE", routingPolicyId: null }),
  );
  const [cacheMode, setCacheMode] = useState<"respect" | "force" | "disable">("respect");
  const [cacheTtlS, setCacheTtlS] = useState<number>(3600);
  const [rpm, setRpm] = useState<string>("");
  const [tpm, setTpm] = useState<string>("");
  const [rpd, setRpd] = useState<string>("");
  const [maxOpenSessions, setMaxOpenSessions] = useState<string>("");
  const [expiration, setExpiration] = useState<VirtualKeyExpirationValue>(NEVER_EXPIRES);
  const [expiryFieldError, setExpiryFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!vk) return;
    setName(vk.name);
    setDescription(vk.description ?? "");
    const config = storedConfig(vk.config);
    setTagsCsv((config.metadata?.tags ?? []).join(", "));
    setCacheMode(config.cache?.mode ?? "respect");
    setCacheTtlS(config.cache?.ttlS ?? 3600);
    setRpm(config.rateLimits?.rpm?.toString() ?? "");
    setTpm(config.rateLimits?.tpm?.toString() ?? "");
    setRpd(config.rateLimits?.rpd?.toString() ?? "");
    setMaxOpenSessions(config.realtime?.maxOpenSessions?.toString() ?? "");
    const providersAllowed = config.providersAllowed ?? null;
    setProviderAccess({
      allProviders: !providersAllowed || providersAllowed.length === 0,
      providerIds: providersAllowed ?? [],
      modelsAllowed: config.modelsAllowed ?? [],
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
    setExpiration(expirationStateFromStored(vk.expiresAt ?? null));
    setExpiryFieldError(null);
  }, [vk]);

  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () => availableProjectsOf(organization?.teams ?? []),
    [organization?.teams],
  );
  const viewTracesHref = useMemo(
    () => tracesHrefFor({ vk, teams: organization?.teams ?? [] }),
    [vk, organization?.teams],
  );

  const utils = api.useUtils();
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!vk && !!organizationId },
  );
  const orgProvidersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
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
    const own = ownManagedBudget({ applicable: applicableQuery.data, virtualKeyId: vk.id });
    if (own) {
      setBudget(own);
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

  const providers = useMemo(
    (): OrgModelProvider[] => orgProvidersQuery.data ?? [],
    [orgProvidersQuery.data],
  );
  const policies = (policiesQuery.data ?? []) as {
    id: string;
    name: string;
  }[];
  const eligible = useMemo(
    () =>
      resolveEligible({
        scopes: vk?.scopes ?? [],
        providers,
        hierarchy: buildScopeHierarchy(availableProjects, organizationId),
      }),
    [vk?.scopes, providers, availableProjects, organizationId],
  );

  const tagsNotice = tagsBeyondLimitsNotice(tagsCsv);
  const expiresAt = resolveExpiresAt({
    preset: expiration.preset,
    customDate: expiration.customDate,
  });
  const expiresAtPatch = expiresAtPatchFor({
    expiration,
    storedExpiresAt: vk?.expiresAt ?? null,
    expiresAt,
  });

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const cannotSaveReason = cannotSaveReasonFor({
    name,
    budget,
    maxOpenSessions,
    providersLoading: orgProvidersQuery.isLoading,
    providerAccess,
    eligible,
    expiration,
    expiresAt,
  });

  const submit = async () => {
    if (!vk) return;
    if (cannotSaveReason) {
      toaster.create({ title: cannotSaveReason, type: "error" });
      return;
    }
    setExpiryFieldError(null);
    try {
      await updateMutation.mutateAsync(
        updateVirtualKeyInput({
          organizationId,
          id: vk.id,
          name,
          description,
          routing,
          expiresAtPatch,
          budget,
          hadManagedBudget,
          access: providerAccessToConfig(providerAccess, eligible),
          cache: { mode: cacheMode, ttlS: cacheTtlS },
          rpm,
          tpm,
          rpd,
          maxOpenSessions,
          tagsCsv,
        }),
      );
      onSaved();
      onOpenChange(false);
    } catch (error) {
      reportUpdateFailure({
        error,
        onExpiryError: setExpiryFieldError,
        onFailure: (title) => toaster.create({ title, type: "error" }),
      });
    }
  };

  return (
    <Drawer.Root open={!!vk} onOpenChange={() => close()} placement="end" size="md">
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
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
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
              {tagsNotice && <Field.HelperText color="orange.600">{tagsNotice}</Field.HelperText>}
            </Field.Root>

            {vk && (
              <>
                <Separator />
                <VirtualKeyOwnershipReadOnly
                  scopes={vk.scopes}
                  principal={vk.principalUserId && vk.principalUser ? vk.principalUser : undefined}
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

            <VirtualKeyLimitsFields
              cacheMode={cacheMode}
              cacheTtlS={cacheTtlS}
              rpm={rpm}
              tpm={tpm}
              rpd={rpd}
              maxOpenSessions={maxOpenSessions}
              onCacheModeChange={setCacheMode}
              onCacheTtlSChange={setCacheTtlS}
              onRpmChange={setRpm}
              onRpdChange={setRpd}
              onMaxOpenSessionsChange={setMaxOpenSessions}
            />
            {vk && (
              <>
                <Separator />
                <VirtualKeyExpirationSection
                  value={expiration}
                  onChange={setExpiration}
                  fieldError={expiryFieldError}
                />
              </>
            )}
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
            <Button variant="ghost" onClick={close} disabled={updateMutation.isPending}>
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
