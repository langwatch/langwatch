import {
  Box,
  Button,
  Code,
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
import { ModelMultiSelect } from "~/components/ModelMultiSelect";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import {
  ConfigureModelProvidersLink,
  EligibleModelProvidersPreview,
  EligibleModelProvidersSummary,
} from "./EligibleModelProvidersPreview";
import { FieldInfoTooltip } from "./FieldInfoTooltip";
import {
  type VirtualKeyScopeEntry,
  VirtualKeyScopePicker,
} from "./VirtualKeyScopePicker";

type VirtualKeyDetail = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "revoked";
  scopes: VirtualKeyScopeEntry[];
  routingPolicyId: string | null;
  config: {
    // null / undefined = no allowlist = every eligible model is allowed.
    // A non-empty list restricts the VK (and the Langy picker) to exactly
    // these `provider/model` ids.
    modelsAllowed?: string[] | null;
    cache?: { mode: "respect" | "force" | "disable"; ttlS: number };
    rateLimits?: {
      rpm: number | null;
      tpm: number | null;
      rpd: number | null;
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

export function VirtualKeyEditDrawer({
  organizationId,
  vk,
  onOpenChange,
  onSaved,
}: VirtualKeyEditDrawerProps) {
  const { organization, team, project } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [routingPolicyId, setRoutingPolicyId] = useState<string>("");
  const [cacheMode, setCacheMode] = useState<"respect" | "force" | "disable">(
    "respect",
  );
  const [cacheTtlS, setCacheTtlS] = useState<number>(3600);
  const [rpm, setRpm] = useState<string>("");
  const [tpm, setTpm] = useState<string>("");
  const [rpd, setRpd] = useState<string>("");
  const [tagsCsv, setTagsCsv] = useState<string>("");
  const [modelsAllowed, setModelsAllowed] = useState<string[]>([]);

  useEffect(() => {
    if (!vk) return;
    setName(vk.name);
    setDescription(vk.description ?? "");
    setRoutingPolicyId(vk.routingPolicyId ?? "");
    setCacheMode(vk.config.cache?.mode ?? "respect");
    setCacheTtlS(vk.config.cache?.ttlS ?? 3600);
    setTagsCsv((vk.config.metadata?.tags ?? []).join(", "));
    setRpm(vk.config.rateLimits?.rpm?.toString() ?? "");
    setTpm(vk.config.rateLimits?.tpm?.toString() ?? "");
    setRpd(vk.config.rateLimits?.rpd?.toString() ?? "");
    setModelsAllowed(vk.config.modelsAllowed ?? []);
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

  const utils = api.useContext();
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!vk && !!organizationId },
  );
  const orgProvidersQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId },
      { enabled: !!vk && !!organizationId },
    );
  const updateMutation = api.virtualKeys.update.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ organizationId });
    },
  });

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!vk) return;
    if (!name) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        organizationId,
        id: vk.id,
        name,
        description: description || null,
        routingPolicyId: routingPolicyId ? routingPolicyId : null,
        config: {
          // Empty selection ⇒ null (no allowlist = all eligible models),
          // never [] (which the gateway would read as "allow zero models").
          modelsAllowed: modelsAllowed.length > 0 ? modelsAllowed : null,
          cache: { mode: cacheMode, ttlS: cacheTtlS },
          rateLimits: {
            rpm: rpm ? Number.parseInt(rpm, 10) : null,
            tpm: tpm ? Number.parseInt(tpm, 10) : null,
            rpd: rpd ? Number.parseInt(rpd, 10) : null,
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
              <>
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
                <EligibleModelProvidersSummary
                  scopes={vk.scopes}
                  organizationId={organizationId}
                  organizationName={organization?.name}
                  availableTeams={availableTeams}
                  availableProjects={availableProjects}
                  isLoading={orgProvidersQuery.isLoading}
                  providers={(orgProvidersQuery.data?.providers ?? []) as any}
                />
              </>
            )}

            <Box>
              <HStack mb={1.5} alignItems="center" gap={2}>
                <ConfigureModelProvidersLink scopes={vk?.scopes ?? []} />
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Eligible model providers
                </Text>
              </HStack>
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

            <Field.Root>
              <Field.Label>
                Models {name ? `“${name}” ` : ""}can use
                <FieldInfoTooltip
                  description="Restrict this virtual key to specific models. Leave everything unchecked to allow every model the eligible providers can serve. For the Langy assistant this is exactly the set its sidebar model picker offers."
                  docHref="/ai-gateway/virtual-keys"
                />
              </Field.Label>
              {/* v1 limitation: the palette comes from the CURRENT project's
                  providers (useModelSelectionOptions). That's correct for the
                  current project's Langy VK — the common case — but editing a
                  different project's VK from the org-wide list would show this
                  project's palette. Per-VK-project sourcing is a follow-up. */}
              <ModelMultiSelect
                value={modelsAllowed}
                onChange={setModelsAllowed}
                mode="chat"
              />
              <Field.HelperText>
                {modelsAllowed.length === 0
                  ? "All eligible models allowed. Check models to restrict."
                  : `${modelsAllowed.length} model${
                      modelsAllowed.length === 1 ? "" : "s"
                    } selected.`}
              </Field.HelperText>
            </Field.Root>

            {((policiesQuery.data ?? []).length > 0 || routingPolicyId) && (
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
                      Default cascade (all eligible providers)
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
            )}

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
              Provider-agnostic: Anthropic uses explicit cache_control markers,
              OpenAI/Azure cache prompts automatically, Gemini supports
              cachedContent references. Mode here applies to every provider this
              VK routes to; the X-LangWatch-Cache request header lets callers
              override per-request.
            </Text>
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
                      Respect — pass provider cache directives through unchanged
                    </option>
                    <option value="disable">
                      Disable — strip cache directives before dispatch
                    </option>
                    <option value="force">
                      Force — inject cache_control on Anthropic (OpenAI auto,
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
                Rate limits (blank = unlimited)
              </Text>
              <FieldInfoTooltip
                description="Per-VK rpm/rpd on the gateway hot path. Independent of per-binding rate limits — whichever trips first blocks. TPM is v1.1 (requires token estimation + Redis cluster counters)."
                docHref="/ai-gateway/rate-limits"
              />
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              Enforced per-VK in-memory on every gateway replica. On breach the
              gateway returns HTTP 429 with{" "}
              <Code fontSize="xs">Retry-After</Code> and{" "}
              <Code fontSize="xs">X-LangWatch-RateLimit-Dimension</Code>.
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
                <Field.Label>tpm</Field.Label>
                <Input
                  value={tpm}
                  onChange={(e) => setTpm(e.target.value)}
                  placeholder="deferred"
                  inputMode="numeric"
                  disabled
                />
                <Field.HelperText>
                  Tokens / minute — requires pre-request token estimation; ships
                  with Redis-coordinated cluster counters (v1.1).
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
