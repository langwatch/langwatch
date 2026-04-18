import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type VirtualKeyCreateDrawerProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { id: string; name: string; secret: string }) => void;
};

/**
 * "New virtual key" drawer — minimum viable form: name, description, env
 * toggle, provider-credential multi-pick. Advanced fields (model aliases,
 * cache mode, fallback triggers) land once the provider-binding UI is in
 * place; for the first-use scenario the defaults are fine.
 */
export function VirtualKeyCreateDrawer({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: VirtualKeyCreateDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);

  const utils = api.useContext();
  const credentialsQuery = api.gatewayProviders.list.useQuery(
    { projectId },
    { enabled: open && !!projectId },
  );
  const createMutation = api.virtualKeys.create.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ projectId });
    },
  });

  const availableProviders = useMemo(
    () => credentialsQuery.data ?? [],
    [credentialsQuery.data],
  );

  const reset = () => {
    setName("");
    setDescription("");
    setEnvironment("live");
    setSelectedProviderIds([]);
  };

  const handleClose = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!name || selectedProviderIds.length === 0) {
      toaster.create({
        title: "Name and at least one provider are required",
        type: "error",
      });
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        projectId,
        name,
        description: description || undefined,
        environment,
        providerCredentialIds: selectedProviderIds,
      });
      onCreated({
        id: result.virtualKey.id,
        name: result.virtualKey.name,
        secret: result.secret,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to create virtual key",
        type: "error",
      });
    }
  };

  const toggleProvider = (id: string) => {
    setSelectedProviderIds((current) =>
      current.includes(id)
        ? current.filter((pid) => pid !== id)
        : [...current, id],
    );
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(details) => handleClose()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>New virtual key</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
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
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. codex-prod"
                maxLength={128}
                autoFocus
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional. Shown in the list."
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Environment</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={environment}
                  onChange={(e) =>
                    setEnvironment(
                      (e.target.value as "live" | "test") ?? "live",
                    )
                  }
                >
                  <option value="live">Live</option>
                  <option value="test">Test</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Shape-of-key prefix (lw_vk_live_ vs lw_vk_test_) for
                accident-prevention.
              </Field.HelperText>
            </Field.Root>
            <Field.Root required>
              <Field.Label>Provider fallback chain</Field.Label>
              <VStack align="stretch" gap={2}>
                {credentialsQuery.isLoading ? (
                  <HStack>
                    <Spinner size="sm" />
                    <Text fontSize="sm">Loading providers…</Text>
                  </HStack>
                ) : availableProviders.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    No providers enabled for the gateway yet. Configure one in{" "}
                    <strong>AI Gateway → Providers</strong> first.
                  </Text>
                ) : (
                  availableProviders.map((p: any, index: number) => {
                    const selected = selectedProviderIds.includes(p.id);
                    return (
                      <HStack
                        key={p.id}
                        border="1px solid"
                        borderColor={selected ? "orange.400" : "border.subtle"}
                        borderRadius="md"
                        paddingX={3}
                        paddingY={2}
                        cursor="pointer"
                        onClick={() => toggleProvider(p.id)}
                      >
                        <VStack align="start" gap={0}>
                          <Text fontSize="sm" fontWeight="medium">
                            {p.modelProviderName ?? p.provider ?? p.id}
                          </Text>
                          <Text fontSize="xs" color="fg.muted">
                            slot: {p.slot ?? "primary"}
                          </Text>
                        </VStack>
                        <Spacer />
                        {selected && (
                          <Badge colorPalette="orange">
                            #{selectedProviderIds.indexOf(p.id) + 1}
                          </Badge>
                        )}
                      </HStack>
                    );
                  })
                )}
              </VStack>
              <Field.HelperText>
                Select one or more provider credentials. Order controls
                fallback priority; re-order with drag later.
              </Field.HelperText>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={handleSubmit}
              loading={createMutation.isPending}
              disabled={!name || selectedProviderIds.length === 0}
            >
              Create
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
