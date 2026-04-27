import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";

import { FieldInfoTooltip } from "./FieldInfoTooltip";

type MpScope = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };
type BindableProvider = {
  id: string;
  provider: string;
  scopes?: MpScope[];
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
};

type ProviderBindingCreateDrawerProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

// Rotation policy: v1 ships MANUAL only. Scheduled rotation + external
// secret store integration are v1.1; the field is omitted from the
// create UI since there's only one valid value — the column stays in
// the DB (defaulted to MANUAL) so forward-compat works when v1.1
// lands. See iter 56 dogfood feedback.

export function ProviderBindingCreateDrawer({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: ProviderBindingCreateDrawerProps) {
  const { project } = useOrganizationTeamProject();
  // /settings/* is global (org-scoped), not project-scoped — prefixing with
  // the project slug yields a broken URL. Settings pages live under /settings
  // across the platform.
  const settingsHref = "/settings/model-providers";
  const [modelProviderId, setModelProviderId] = useState("");
  const [slot, setSlot] = useState("primary");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [rateLimitTpm, setRateLimitTpm] = useState("");

  const utils = api.useContext();
  const providersQuery = api.modelProvider.getAllForProject.useQuery(
    { projectId },
    { enabled: open && !!projectId },
  );
  const existingBindingsQuery = api.gatewayProviders.list.useQuery(
    { projectId },
    { enabled: open && !!projectId },
  );

  const createMutation = api.gatewayProviders.create.useMutation({
    onSuccess: async () => {
      await utils.gatewayProviders.list.invalidate({ projectId });
    },
  });

  const reset = () => {
    setModelProviderId("");
    setSlot("primary");
    setRateLimitRpm("");
    setRateLimitTpm("");
  };

  const close = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const submit = async () => {
    if (!modelProviderId) {
      toaster.create({ title: "Select a model provider", type: "error" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        projectId,
        modelProviderId,
        slot: slot || undefined,
        rateLimitRpm: rateLimitRpm ? Number.parseInt(rateLimitRpm, 10) : null,
        rateLimitTpm: rateLimitTpm ? Number.parseInt(rateLimitTpm, 10) : null,
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "Failed to bind provider",
        type: "error",
      });
    }
  };

  const providersRecord = providersQuery.data ?? {};
  const enabledProviders = Object.values(providersRecord).filter(
    (p: any) => p?.enabled && p?.id,
  ) as BindableProvider[];
  const boundIds = new Set(
    (existingBindingsQuery.data ?? []).map((b) => b.modelProviderId),
  );
  const available: BindableProvider[] = enabledProviders.filter(
    (p) => !boundIds.has(p.id),
  );

  const providerCollection = useMemo(
    () =>
      createListCollection({
        items: available.map((p) => ({
          value: p.id,
          label: p.provider,
        })),
      }),
    [available],
  );

  const selected = available.find((p) => p.id === modelProviderId);
  const selectedIsShared = selected?.scopes?.some(
    (s) => s.scopeType === "ORGANIZATION" || s.scopeType === "TEAM",
  ) || selected?.scopeType === "ORGANIZATION" || selected?.scopeType === "TEAM";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Bind provider to gateway</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>
                Model provider
                <FieldInfoTooltip
                  description="The LLM provider whose API key the gateway routes traffic to. Providers are configured once in Settings → Model Providers and reused here."
                  docHref="/ai-gateway/provider-bindings#model-provider"
                />
              </Field.Label>
              {providersQuery.isLoading ? (
                <Spinner size="sm" />
              ) : available.length === 0 ? (
                <VStack align="stretch" gap={2}>
                  <Text fontSize="sm" color="fg.muted">
                    All enabled model providers are already bound, or none are
                    configured yet.
                  </Text>
                  <Link
                    href={settingsHref}
                    color="orange.600"
                    fontSize="sm"
                    fontWeight="medium"
                  >
                    Configure providers in Settings →
                  </Link>
                </VStack>
              ) : (
                <Select.Root
                  collection={providerCollection}
                  value={modelProviderId ? [modelProviderId] : []}
                  onValueChange={(change) =>
                    setModelProviderId(change.value[0] ?? "")
                  }
                  width="full"
                  size="sm"
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Select a provider">
                      {(items) => {
                        const item = items[0];
                        if (!item) return "Select a provider";
                        const provider =
                          typeof item === "object" && "label" in item
                            ? (item as { label: string }).label
                            : "";
                        const match = available.find((p) => p.id === modelProviderId);
                        return (
                          <HStack gap={2}>
                            <ProviderIconBox provider={provider} />
                            <Text>{provider}</Text>
                            {match && (
                              <ProviderScopeChips
                                scopes={match.scopes}
                                fallbackScopeType={match.scopeType}
                              />
                            )}
                          </HStack>
                        );
                      }}
                    </Select.ValueText>
                  </Select.Trigger>
                  <Select.Content>
                    {available.map((p) => (
                      <Select.Item
                        item={{ value: p.id, label: p.provider }}
                        key={p.id}
                      >
                        <HStack gap={2} width="full">
                          <ProviderIconBox provider={p.provider} />
                          <Text>{p.provider}</Text>
                          <Spacer />
                          <ProviderScopeChips
                            scopes={p.scopes}
                            fallbackScopeType={p.scopeType}
                          />
                        </HStack>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              )}
              <Field.HelperText>
                {selectedIsShared ? (
                  <>
                    This credential is scoped to the{" "}
                    {selected?.scopes?.some(
                      (s) => s.scopeType === "ORGANIZATION",
                    ) || selected?.scopeType === "ORGANIZATION"
                      ? "organization"
                      : "team"}
                    , so any project with access can bind it to the gateway.
                    Binding here only stores this project's gateway-specific
                    settings (rate limits, fallback priority); the API key
                    stays managed in{" "}
                    <Link href={settingsHref} color="orange.600">
                      Settings → Model Providers
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Gateway reuses the ModelProvider API key from{" "}
                    <Link href={settingsHref} color="orange.600">
                      Settings → Model Providers
                    </Link>
                    . Binding only adds gateway-specific settings (rate limits,
                    fallback priority).
                  </>
                )}
              </Field.HelperText>
            </Field.Root>
            <Field.Root>
              <Field.Label>
                Slot
                <FieldInfoTooltip
                  description="Free-text tag used by virtual keys to reference this binding in their fallback chain. Typical names: primary, fallback-1, eu-region, canary. Defaults to 'primary'."
                  docHref="/ai-gateway/provider-bindings#slot"
                />
              </Field.Label>
              <Input
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder="e.g. primary, fallback-1"
              />
              <Field.HelperText>
                Logical name used in the fallback chain. Defaults to
                "primary". Must be unique per provider — binding the
                same provider with the same slot twice is rejected by
                the server.
              </Field.HelperText>
            </Field.Root>
            {/* Rotation policy field intentionally omitted — v1 is
                manual-only (see iter 56 dogfood). Backend defaults
                new rows to MANUAL; v1.1 lands scheduled rotation +
                external-secret-store integration. */}
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>
                  Rate limit (rpm)
                  <FieldInfoTooltip
                    description="Requests Per Minute ceiling on this binding. Sliding window; 429 + Retry-After emitted at breach. Blank = unlimited (upstream provider limits still apply)."
                    docHref="/ai-gateway/rate-limits#rpm"
                  />
                </Field.Label>
                <Input
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(e.target.value)}
                  placeholder="blank = unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>
                  Rate limit (tpm)
                  <FieldInfoTooltip
                    description="Tokens Per Minute ceiling on this binding. Deferred to v1.1 — configurable here now for forward compat, but the gateway does not enforce TPM until the streaming-usage accumulator lands."
                    docHref="/ai-gateway/rate-limits#tpm"
                  />
                </Field.Label>
                <Input
                  value={rateLimitTpm}
                  onChange={(e) => setRateLimitTpm(e.target.value)}
                  placeholder="blank = unlimited"
                  inputMode="numeric"
                />
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
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={submit}
              loading={createMutation.isPending}
              disabled={!modelProviderId}
            >
              Bind provider
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function ProviderIconBox({ provider }: { provider: string }) {
  const icon =
    provider in modelProviderIcons
      ? modelProviderIcons[provider as keyof typeof modelProviderIcons]
      : null;
  return (
    <Box
      width="18px"
      height="18px"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      css={{
        "& > svg": { width: "100%", height: "100%" },
      }}
    >
      {icon}
    </Box>
  );
}
