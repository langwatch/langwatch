import { TriggerAction } from "@langwatch/automation-contract";
import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Settings2 } from "lucide-react";

import { useAutomationHost } from "../../../../model/automation-host.ts";
import { FacetSection, type FacetAccordionProps } from "../elements/facet-section.tsx";
import { useConfigComplete, useConfigurationSummary } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CLIENT_PROVIDERS, type AutomationProviderRegistry } from "./client-providers.ts";
import type { ConditionSource } from "./draft-model.ts";

/** The active channel card is tinted with the preset's list-page accent. */
const ACCENT_FOR_SOURCE: Record<ConditionSource, string> = {
  trace: "blue",
  customGraph: "orange",
  report: "purple",
};

/** Alex's wording (ARCHITECTURE.md §6): the one place "off" is said out loud. */
const EMAIL_NOT_CONFIGURED = "Email is not configured. Ask an admin to set up a mail provider.";

type AutomationProviderEntry = AutomationProviderRegistry[keyof AutomationProviderRegistry];

/**
 * The Delivery facet (ADR-043 facet 6): cards come from `CLIENT_PROVIDERS`, grouped by
 * `shared.category`; graph-watching automations and schedules only notify (the router
 * enforces it server-side), and a schedule never offers the webhook card.
 */
export function DeliveryPicker({
  value,
  onChange,
  source,
  accordion,
}: {
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  source: ConditionSource;
  accordion?: FacetAccordionProps;
}) {
  const setSection = useAutomationStore((s) => s.setSection);
  const configComplete = useConfigComplete();
  const configSummary = useConfigurationSummary();
  const emailUnavailable = !useAutomationHost().hasEmailProvider();
  const notifyOnly = source === "customGraph" || source === "report";
  // The scheduled-report dispatch is email/Slack only.
  const hasEndpointDelivery = source !== "report";
  const entries = Object.values(CLIENT_PROVIDERS).filter(
    (e) => e.shared.action !== TriggerAction.SEND_WEBHOOK || hasEndpointDelivery,
  );
  const notify = entries.filter((e) => e.shared.category === "notify");
  const action = entries.filter((e) => e.shared.category === "action");
  const accent = ACCENT_FOR_SOURCE[source];

  // Picking a channel drops the author straight into its setup — no separate,
  // easy-to-miss "Setup" row to hunt for further down the page.
  const pick = (next: TriggerAction) => {
    onChange(next);
    setSection("configuration");
  };

  return (
    <FacetSection
      title="Delivery"
      help={
        hasEndpointDelivery
          ? "Where the notification goes and what it sends. Notify channels post to Slack, send email, or call an endpoint. Actions add matching traces to a dataset or annotation queue."
          : "Where the notification goes and what it sends. Notify channels post to Slack or send email."
      }
      accordion={accordion}
      complete={configComplete}
      summary={value ? configSummary : "Choose where it goes"}
    >
      <VStack align="stretch" gap={3}>
        {notify.length > 0 ? (
          <DeliveryGroup
            label="Notify"
            description={
              hasEndpointDelivery
                ? "Tell someone through Slack, email, or an endpoint."
                : "Tell someone through Slack or email."
            }
            entries={notify}
            value={value}
            onChange={pick}
            source={source}
            accent={accent}
            emailUnavailable={emailUnavailable}
          />
        ) : null}
        {action.length > 0 && !notifyOnly ? (
          <DeliveryGroup
            label="Action"
            description="Do something to the matched trace."
            entries={action}
            value={value}
            onChange={pick}
            source={source}
            accent={accent}
            emailUnavailable={emailUnavailable}
          />
        ) : null}
        {value ? (
          <HStack
            justify="space-between"
            gap={3}
            padding={2.5}
            borderRadius="md"
            borderWidth="1px"
            borderColor={configComplete ? "green.solid" : "border"}
            colorPalette="green"
          >
            <Text textStyle="xs" color="fg.muted" lineClamp={1} minWidth="0">
              {configComplete ? configSummary : "Finish the setup to save."}
            </Text>
            <Button
              size="xs"
              variant="outline"
              flexShrink={0}
              data-testid="automation-delivery-edit-setup"
              onClick={() => setSection("configuration")}
            >
              <Settings2 size={13} /> Edit setup
            </Button>
          </HStack>
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
  source,
  accent,
  emailUnavailable,
}: {
  label: string;
  description: string;
  entries: AutomationProviderEntry[];
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  source: ConditionSource;
  accent: string;
  emailUnavailable: boolean;
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
            source={source}
            accent={accent}
            disabledReason={
              emailUnavailable && entry.shared.action === TriggerAction.SEND_EMAIL
                ? EMAIL_NOT_CONFIGURED
                : void 0
            }
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
  source,
  accent,
  disabledReason,
}: {
  entry: AutomationProviderEntry;
  active: boolean;
  onClick: () => void;
  source: ConditionSource;
  accent: string;
  /** Set when the channel cannot be chosen on this installation; shown on hover. */
  disabledReason?: string;
}) {
  const Icon = entry.client.Icon;
  const disabled = disabledReason !== void 0;
  const card = (
    <chakra.button
      type="button"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      colorPalette={accent}
      borderColor={active ? "colorPalette.emphasized" : "border"}
      bg={active ? "colorPalette.subtle" : "bg"}
      cursor={disabled ? "not-allowed" : "pointer"}
      opacity={disabled ? 0.6 : 1}
      aria-disabled={disabled || undefined}
      data-testid={`automation-delivery-${entry.shared.action.toLowerCase().replaceAll("_", "-")}`}
      onClick={disabled ? undefined : onClick}
    >
      <HStack gap={2} mb={1}>
        <Icon size={18} />
        <Text fontWeight="semibold">{entry.shared.label}</Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {descriptionFor({ shared: entry.shared, source })}
      </Text>
    </chakra.button>
  );
  return disabled ? <Tooltip content={disabledReason}>{card}</Tooltip> : card;
}

/** The card's line in the words of what is being delivered. */
function descriptionFor({
  shared,
  source,
}: {
  shared: AutomationProviderEntry["shared"];
  source: ConditionSource;
}): string {
  if (source === "customGraph") return shared.alertDescription ?? shared.description;
  if (source === "report") return shared.reportDescription ?? shared.description;
  return shared.description;
}
