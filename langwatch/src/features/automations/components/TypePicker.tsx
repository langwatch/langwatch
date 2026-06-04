import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import type { ClientEntry } from "~/automations/providers/types";

/**
 * The provider-card picker on the main drawer's Type section. Entries come
 * straight from `CLIENT_PROVIDERS` so adding a definition registers a new
 * card here automatically.
 *
 * Grouped by `shared.category` (`notify` first, then `action`) because more
 * action types are coming and a single 2×N grid stops reading as "pick how
 * to be alerted vs. pick a side-effect" once the list crosses ~4 entries.
 * The two groups also let an `action`-only future deployment hide the
 * Notify group cleanly via the category filter.
 */
export function TypePicker({
  value,
  onChange,
}: {
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
}) {
  const entries = Object.values(CLIENT_PROVIDERS);
  const notify = entries.filter((e) => e.shared.category === "notify");
  const action = entries.filter((e) => e.shared.category === "action");

  return (
    <Box padding={3} borderRadius="md" border="1px solid" borderColor="border">
      <Text fontWeight="semibold" mb={3}>
        Type
      </Text>
      <VStack align="stretch" gap={3}>
        {notify.length > 0 ? (
          <TypeGroup
            label="Notify"
            description="Tell someone — Slack, email, webhook."
            entries={notify}
            value={value}
            onChange={onChange}
          />
        ) : null}
        {action.length > 0 ? (
          <TypeGroup
            label="Action"
            description="Do something to the matched trace."
            entries={action}
            value={value}
            onChange={onChange}
          />
        ) : null}
      </VStack>
    </Box>
  );
}

function TypeGroup({
  label,
  description,
  entries,
  value,
  onChange,
}: {
  label: string;
  description: string;
  entries: ClientEntry[];
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={2} align="baseline">
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wide"
        >
          {label}
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {description}
        </Text>
      </HStack>
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
    </VStack>
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
      type="button"
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

