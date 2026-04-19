import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

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
  const settingsHref = project
    ? `/${project.slug}/settings/model-providers`
    : "#";
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
  );
  const boundIds = new Set(
    (existingBindingsQuery.data ?? []).map((b) => b.modelProviderId),
  );
  const available = enabledProviders.filter((p: any) => !boundIds.has(p.id));

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
              <Field.Label>Model provider</Field.Label>
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
                <VStack align="stretch" gap={2}>
                  {available.map((p: any) => {
                    const selected = modelProviderId === p.id;
                    const icon =
                      modelProviderIcons[
                        p.provider as keyof typeof modelProviderIcons
                      ];
                    return (
                      <HStack
                        key={p.id}
                        borderWidth="1px"
                        borderColor={selected ? "orange.400" : "border.subtle"}
                        borderRadius="md"
                        paddingX={3}
                        paddingY={2}
                        cursor="pointer"
                        onClick={() => setModelProviderId(p.id)}
                        background={selected ? "orange.50" : undefined}
                        _hover={{ borderColor: "orange.300" }}
                      >
                        <Box width="20px" height="20px" flexShrink={0}>
                          {icon}
                        </Box>
                        <Text fontSize="sm" fontWeight="medium">
                          {p.provider}
                        </Text>
                      </HStack>
                    );
                  })}
                </VStack>
              )}
              <Field.HelperText>
                Gateway reuses the ModelProvider API key from{" "}
                <Link href={settingsHref} color="orange.600">
                  Settings → Model Providers
                </Link>
                . Binding only adds gateway-specific settings (rate limits,
                fallback priority).
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
            {/* Rotation policy field intentionally omitted — v1 is
                manual-only (see iter 56 dogfood). Backend defaults
                new rows to MANUAL; v1.1 lands scheduled rotation +
                external-secret-store integration. */}
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
