import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type ProviderBindingCreateDrawerProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type RotationPolicy = "MANUAL" | "AUTO" | "EXTERNAL_SECRET_STORE";

export function ProviderBindingCreateDrawer({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: ProviderBindingCreateDrawerProps) {
  const [modelProviderId, setModelProviderId] = useState("");
  const [slot, setSlot] = useState("primary");
  const [rotationPolicy, setRotationPolicy] = useState<RotationPolicy>("MANUAL");
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
    setRotationPolicy("MANUAL");
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
        rotationPolicy,
        rateLimitRpm: rateLimitRpm ? Number.parseInt(rateLimitRpm, 10) : null,
        rateLimitTpm: rateLimitTpm ? Number.parseInt(rateLimitTpm, 10) : null,
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to bind provider",
        type: "error",
      });
    }
  };

  const providersRecord = providersQuery.data ?? {};
  const enabledProviders = Object.values(providersRecord).filter(
    (p: any) => p?.enabled && p?.id,
  );
  const boundIds = new Set(
    (existingBindingsQuery.data ?? []).map((b) => b.modelProviderId),
  );
  const available = enabledProviders.filter(
    (p: any) => !boundIds.has(p.id),
  );

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>Bind provider to gateway</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={createMutation.isPending}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>Model provider</Field.Label>
              {providersQuery.isLoading ? (
                <Spinner size="sm" />
              ) : available.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  All enabled model providers are already bound. Enable another
                  one in Settings → Model Providers.
                </Text>
              ) : (
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={modelProviderId}
                    onChange={(e) => setModelProviderId(e.target.value)}
                  >
                    <option value="">Select a provider…</option>
                    {available.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.provider}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              )}
              <Field.HelperText>
                Gateway reuses the ModelProvider API key already configured in
                settings. Binding only adds gateway-specific settings.
              </Field.HelperText>
            </Field.Root>
            <Field.Root>
              <Field.Label>Slot</Field.Label>
              <Input
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder="e.g. primary, fallback-1"
              />
              <Field.HelperText>
                Logical name used in the fallback chain. Defaults to "primary".
              </Field.HelperText>
            </Field.Root>
            <Field.Root>
              <Field.Label>Rotation policy</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={rotationPolicy}
                  onChange={(e) =>
                    setRotationPolicy(
                      (e.target.value as RotationPolicy) ?? "MANUAL",
                    )
                  }
                >
                  <option value="MANUAL">Manual</option>
                  <option value="AUTO">Automatic (rotate on schedule)</option>
                  <option value="EXTERNAL_SECRET_STORE">
                    External secret store (HashiCorp Vault, etc.)
                  </option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>Rate limit (rpm)</Field.Label>
                <Input
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(e.target.value)}
                  placeholder="blank = unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>Rate limit (tpm)</Field.Label>
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
