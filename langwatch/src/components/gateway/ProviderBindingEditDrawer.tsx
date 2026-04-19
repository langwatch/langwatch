import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type ProviderBindingRow = {
  id: string;
  modelProviderName: string;
  slot: string;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  rotationPolicy: string;
  fallbackPriorityGlobal: number | null;
};

type ProviderBindingEditDrawerProps = {
  projectId: string;
  binding: ProviderBindingRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type RotationPolicy = "MANUAL" | "AUTO" | "EXTERNAL_SECRET_STORE";

export function ProviderBindingEditDrawer({
  projectId,
  binding,
  onOpenChange,
  onSaved,
}: ProviderBindingEditDrawerProps) {
  const [slot, setSlot] = useState("primary");
  const [rotationPolicy, setRotationPolicy] =
    useState<RotationPolicy>("MANUAL");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [rateLimitRpd, setRateLimitRpd] = useState("");
  const [fallbackPriority, setFallbackPriority] = useState("");

  useEffect(() => {
    if (!binding) return;
    setSlot(binding.slot);
    setRotationPolicy(
      (binding.rotationPolicy.toUpperCase() as RotationPolicy) ?? "MANUAL",
    );
    setRateLimitRpm(binding.rateLimitRpm?.toString() ?? "");
    setRateLimitRpd(binding.rateLimitRpd?.toString() ?? "");
    setFallbackPriority(binding.fallbackPriorityGlobal?.toString() ?? "");
  }, [binding]);

  const utils = api.useContext();
  const updateMutation = api.gatewayProviders.update.useMutation({
    onSuccess: async () => {
      await utils.gatewayProviders.list.invalidate({ projectId });
    },
  });

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!binding) return;
    try {
      await updateMutation.mutateAsync({
        projectId,
        id: binding.id,
        slot: slot || undefined,
        rotationPolicy,
        rateLimitRpm: rateLimitRpm ? Number.parseInt(rateLimitRpm, 10) : null,
        rateLimitRpd: rateLimitRpd ? Number.parseInt(rateLimitRpd, 10) : null,
        fallbackPriorityGlobal: fallbackPriority
          ? Number.parseInt(fallbackPriority, 10)
          : null,
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "Failed to update binding",
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root
      open={!!binding}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>Edit provider binding</Drawer.Title>
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
          <VStack align="stretch" gap={4}>
            <Field.Root>
              <Field.Label>Provider</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {binding?.modelProviderName} (immutable — rebind to change)
              </Text>
            </Field.Root>
            <Field.Root>
              <Field.Label>Slot</Field.Label>
              <Input
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                placeholder="e.g. primary, fallback-1"
              />
              <Field.HelperText>
                Logical name used in the VK fallback chain.
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
                    External secret store
                  </option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
            <HStack gap={4} align="flex-start">
              <Field.Root flex={1}>
                <Field.Label>
                  Rate limit (rpm){" "}
                  <Badge colorPalette="gray" fontSize="2xs" ml={1}>
                    per-binding
                  </Badge>
                </Field.Label>
                <Input
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>Rate limit (rpd)</Field.Label>
                <Input
                  value={rateLimitRpd}
                  onChange={(e) => setRateLimitRpd(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
            </HStack>
            <Field.Root>
              <Field.Label>Fallback priority (global)</Field.Label>
              <Input
                value={fallbackPriority}
                onChange={(e) => setFallbackPriority(e.target.value)}
                placeholder="none — ordered only via VK fallback chain"
                inputMode="numeric"
              />
              <Field.HelperText>
                Lower numbers tried first when a VK leaves the slot unset.
                Leave blank to rely only on per-VK fallback ordering.
              </Field.HelperText>
            </Field.Root>
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
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
