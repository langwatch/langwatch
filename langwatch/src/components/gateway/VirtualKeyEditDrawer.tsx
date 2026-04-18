import {
  Badge,
  Box,
  Button,
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
  };
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
  }, [vk]);

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
              Rate limits (null = unlimited)
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
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>tpm</Field.Label>
                <Input
                  value={tpm}
                  onChange={(e) => setTpm(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
              <Field.Root flex={1}>
                <Field.Label>rpd</Field.Label>
                <Input
                  value={rpd}
                  onChange={(e) => setRpd(e.target.value)}
                  placeholder="unlimited"
                  inputMode="numeric"
                />
              </Field.Root>
            </HStack>

            <Box paddingTop={2}>
              <Text fontSize="xs" color="fg.muted">
                Advanced controls (guardrails, blocked patterns for
                tools/MCP/URLs, fallback triggers, principal binding) are
                editable via the REST/CLI until a dedicated tab lands.
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
