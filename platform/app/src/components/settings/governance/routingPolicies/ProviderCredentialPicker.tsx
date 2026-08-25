import {
  Box,
  Button,
  HStack,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useMemo } from "react";

import { Link } from "~/components/ui/link";

/** Provider names read the same everywhere they appear. */
function formatLabel(option: ProviderCredentialOption): string {
  return option.slot && option.slot !== "primary"
    ? `${option.modelProviderName} (${option.slot})`
    : option.modelProviderName;
}

export type ProviderCredentialOption = {
  id: string;
  modelProviderName: string;
  slot: string;
  disabledAt: string | null;
  healthStatus: string;
};

/**
 * Ordered multi-select for the providers a policy routes through. The order
 * is the order the gateway tries them in.
 *
 * A dropdown of the organization's configured providers by name rather than a
 * free-text field: the underlying value is an opaque identifier, and every
 * hand-typed one was a rejected save.
 */
export function ProviderCredentialPicker({
  selectedIds,
  onChange,
  available,
  loading,
  modelProvidersAdminPath,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
  available: ProviderCredentialOption[];
  loading: boolean;
  modelProvidersAdminPath: string | null;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, ProviderCredentialOption>();
    for (const c of available) map.set(c.id, c);
    return map;
  }, [available]);

  // A disabled provider never appears as a new pick. It can stay in a list
  // that already references it, but offering one would mean choosing a
  // provider that fails the moment a key routes through it.
  const activeAvailable = useMemo(
    () => available.filter((c) => !c.disabledAt),
    [available],
  );
  const remaining = useMemo(
    () => activeAvailable.filter((c) => !selectedIds.includes(c.id)),
    [activeAvailable, selectedIds],
  );
  const hasOnlyDisabledProviders = available.length > 0 && activeAvailable.length === 0;

  const { removeAt, swap, addById } = orderedListHandlers({
    selectedIds,
    onChange,
  });

  if (loading) {
    return (
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text fontSize="sm" color="fg.muted">
          Loading model providers
        </Text>
      </HStack>
    );
  }

  if (available.length === 0 && selectedIds.length === 0) {
    return (
      <NoProvidersToPick
        title="No model providers yet"
        body="A routing policy points at one or more model providers. Configure at least one before saving this policy."
        modelProvidersAdminPath={modelProvidersAdminPath}
      />
    );
  }

  if (hasOnlyDisabledProviders && selectedIds.length === 0) {
    return (
      <NoProvidersToPick
        title="All model providers are disabled"
        body={`${
          available.length === 1
            ? "This organization has one model provider and it is disabled."
            : `All ${available.length} of this organization's model providers are disabled.`
        } Re-enable one, or add another, before this policy can route traffic.`}
        modelProvidersAdminPath={modelProvidersAdminPath}
      />
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      {selectedIds.length > 0 && (
        <SelectedProviders
          selectedIds={selectedIds}
          byId={byId}
          onSwap={swap}
          onRemove={removeAt}
        />
      )}
      <AddProvider remaining={remaining} onAdd={addById} />
    </VStack>
  );
}

/** The picker for the providers not already in the list. */
function AddProvider({
  remaining,
  onAdd,
}: {
  remaining: ProviderCredentialOption[];
  onAdd: (id: string) => void;
}) {
  if (remaining.length === 0) {
    return (
      <Text fontSize="xs" color="fg.muted">
        All configured model providers are in this policy.
      </Text>
    );
  }
  return (
    <NativeSelect.Root size="sm">
      <NativeSelect.Field
        value=""
        aria-label="Add model provider"
        onChange={(event) => {
          const value = event.target.value;
          if (value) {
            onAdd(value);
            event.target.value = "";
          }
        }}
      >
        <option value="">Add a model provider</option>
        {remaining.map((option) => (
          <option key={option.id} value={option.id}>
            {formatLabel(option)}
          </option>
        ))}
      </NativeSelect.Field>
    </NativeSelect.Root>
  );
}

/** The two zero states, which differ only in what they say. */
function NoProvidersToPick({
  title,
  body,
  modelProvidersAdminPath,
}: {
  title: string;
  body: string;
  modelProvidersAdminPath: string | null;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="orange.300"
      borderRadius="md"
      backgroundColor="orange.50"
      padding={3}
    >
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="semibold">
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {body}
        </Text>
        {modelProvidersAdminPath && (
          <Link
            href={modelProvidersAdminPath}
            color="orange.700"
            fontSize="xs"
            fontWeight="medium"
          >
            Open model providers
          </Link>
        )}
      </VStack>
    </Box>
  );
}

/** The chosen providers, in the order the gateway tries them. */
function SelectedProviders({
  selectedIds,
  byId,
  onSwap,
  onRemove,
}: {
  selectedIds: string[];
  byId: Map<string, ProviderCredentialOption>;
  onSwap: (a: number, b: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      {selectedIds.map((id, index) => {
        const option = byId.get(id);
        return (
          <HStack
            key={`${id}-${index}`}
            borderWidth="1px"
            borderColor={option ? "border.muted" : "red.300"}
            borderRadius="sm"
            paddingX={2}
            paddingY={1}
            gap={2}
            backgroundColor={option ? "bg.subtle" : "red.50"}
          >
            <Text fontSize="xs" color="fg.muted" minWidth="20px">
              {index + 1}.
            </Text>
            <VStack align="start" gap={0} flex={1} minWidth={0}>
              <Text fontSize="sm" fontWeight="medium">
                {option ? formatLabel(option) : "This provider is no longer configured"}
              </Text>
              {option?.disabledAt && (
                <Text fontSize="xs" color="orange.600">
                  Disabled, so requests skip it
                </Text>
              )}
            </VStack>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onSwap(index, index - 1)}
              disabled={index === 0}
              aria-label="Move up"
            >
              <ArrowUp size={12} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onSwap(index, index + 1)}
              disabled={index === selectedIds.length - 1}
              aria-label="Move down"
            >
              <ArrowDown size={12} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onRemove(index)}
              aria-label="Remove"
            >
              <X size={12} />
            </Button>
          </HStack>
        );
      })}
    </VStack>
  );
}

/** Add, remove and reorder over an ordered id list. */
function orderedListHandlers({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  return {
    removeAt: (index: number) => onChange(selectedIds.filter((_, at) => at !== index)),
    swap: (a: number, b: number) => {
      if (a < 0 || b < 0 || a >= selectedIds.length || b >= selectedIds.length) {
        return;
      }
      const next = selectedIds.slice();
      const held = next[a]!;
      next[a] = next[b]!;
      next[b] = held;
      onChange(next);
    },
    addById: (id: string) => {
      if (!id || selectedIds.includes(id)) return;
      onChange([...selectedIds, id]);
    },
  };
}
