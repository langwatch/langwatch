import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import type { ClientEntry } from "~/automations/providers/types";
import type { ConditionSource } from "../logic/draftReducer";
import { FacetSection } from "./FacetSection";

/** The active channel card is tinted with the preset's list-page accent. */
const ACCENT_FOR_SOURCE: Record<ConditionSource, string> = {
  trace: "blue",
  customGraph: "orange",
  report: "purple",
};

/**
 * The Delivery facet (ADR-043 facet 6) — where it goes and what it sends.
 * Cards come straight from `CLIENT_PROVIDERS` so registering a provider adds
 * a card automatically. Grouped by `shared.category` (`notify` first, then
 * `action`); alerts and reports only ever notify, so the `action` group is
 * hidden for them (the router enforces the same rule server-side). The
 * guided template authoring lives one level down, behind the setup row.
 */
export function DeliveryPicker({
  value,
  onChange,
  source,
}: {
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  source: ConditionSource;
}) {
  const entries = Object.values(CLIENT_PROVIDERS);
  const notify = entries.filter((e) => e.shared.category === "notify");
  const action = entries.filter((e) => e.shared.category === "action");
  const isAlertKind = source === "customGraph";
  const notifyOnly = isAlertKind || source === "report";
  const accent = ACCENT_FOR_SOURCE[source];

  return (
    <FacetSection
      title="Delivery"
      help="Where the notification goes and what it sends. Notify channels post to Slack, email, or a webhook; actions add matching traces to a dataset or annotation queue."
    >
      <VStack align="stretch" gap={3}>
        {notify.length > 0 ? (
          <DeliveryGroup
            label="Notify"
            description="Tell someone — Slack, email, webhook."
            entries={notify}
            value={value}
            onChange={onChange}
            isAlertKind={isAlertKind}
            accent={accent}
          />
        ) : null}
        {action.length > 0 && !notifyOnly ? (
          <DeliveryGroup
            label="Action"
            description="Do something to the matched trace."
            entries={action}
            value={value}
            onChange={onChange}
            isAlertKind={isAlertKind}
            accent={accent}
          />
        ) : null}
      </VStack>
    </FacetSection>
  );
}

function DeliveryGroup({
  label,
  description,
  entries,
  value,
  onChange,
  isAlertKind,
  accent,
}: {
  label: string;
  description: string;
  entries: ClientEntry[];
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  isAlertKind: boolean;
  accent: string;
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
          <DeliveryCard
            key={entry.shared.action}
            entry={entry}
            active={entry.shared.action === value}
            onClick={() => onChange(entry.shared.action)}
            isAlertKind={isAlertKind}
            accent={accent}
          />
        ))}
      </Box>
    </VStack>
  );
}

function DeliveryCard({
  entry,
  active,
  onClick,
  isAlertKind,
  accent,
}: {
  entry: ClientEntry;
  active: boolean;
  onClick: () => void;
  isAlertKind: boolean;
  accent: string;
}) {
  const Icon = entry.client.Icon;
  return (
    <chakra.button
      type="button"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      colorPalette={accent}
      borderColor={active ? "colorPalette.emphasized" : "border"}
      bg={active ? "colorPalette.subtle" : "bg"}
      cursor="pointer"
      onClick={onClick}
    >
      <HStack gap={2} mb={1}>
        <Icon size={18} />
        <Text fontWeight="semibold">{entry.shared.label}</Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {isAlertKind
          ? (entry.shared.alertDescription ?? entry.shared.description)
          : entry.shared.description}
      </Text>
    </chakra.button>
  );
}
