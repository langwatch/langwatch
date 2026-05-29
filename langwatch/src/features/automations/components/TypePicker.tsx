import { Box, HStack, Text } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import type { ClientEntry } from "~/automations/providers/types";

/**
 * The 2×2 grid of provider cards on the main drawer's Type section. The
 * options come straight from `CLIENT_PROVIDERS` so adding an action
 * registers a new card here automatically.
 */
export function TypePicker({
  value,
  onChange,
}: {
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
}) {
  const entries = Object.values(CLIENT_PROVIDERS);
  return (
    <Box padding={3} borderRadius="md" border="1px solid" borderColor="border">
      <Text fontWeight="semibold" mb={2}>
        Type
      </Text>
      <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
        {entries.map((entry) => (
          <TypeCard
            key={entry.shared.action}
            entry={entry}
            active={entry.shared.action === value}
            onClick={() => onChange(entry.shared.action)}
          />
        ))}
      </Box>
    </Box>
  );
}

function TypeCard({
  entry,
  active,
  onClick,
}: {
  entry: ClientEntry;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = entry.client.Icon;
  return (
    <Box
      as="button"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor={active ? "orange.400" : "border"}
      bg={active ? "orange.50" : "bg"}
      _dark={{ bg: active ? "orange.900" : "bg" }}
      onClick={onClick}
    >
      <HStack gap={2} mb={1}>
        <Icon size={18} />
        <Text fontWeight="semibold">{entry.shared.label}</Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {entry.shared.description}
      </Text>
    </Box>
  );
}
