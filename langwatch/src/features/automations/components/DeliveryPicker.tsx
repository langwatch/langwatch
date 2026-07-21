import { Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { Settings2 } from "lucide-react";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import type { ClientEntry } from "~/features/automations/providers/types";
import type { ConditionSource } from "../logic/draftReducer";
import { useAutomationStore } from "../state/automationStore";
import { useConfigComplete, useConfigurationSummary } from "../state/selectors";
import { type FacetAccordionProps, FacetSection } from "./FacetSection";

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
  webhookEnabled,
  preserveHiddenWebhook,
  accordion,
}: {
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  source: ConditionSource;
  webhookEnabled: boolean;
  preserveHiddenWebhook: boolean;
  accordion?: FacetAccordionProps;
}) {
  const setSection = useAutomationStore((s) => s.setSection);
  const configComplete = useConfigComplete();
  const configSummary = useConfigurationSummary();
  // ADR-040: the webhook channel ships dark. The card is hidden until the
  // flag is on (the save/test routes are gated server-side too), and never
  // offered for reports — the scheduled-report dispatch is email/Slack only.
  const isAlertKind = source === "customGraph";
  const notifyOnly = isAlertKind || source === "report";
  const webhookReadOnly =
    preserveHiddenWebhook &&
    value === TriggerAction.SEND_WEBHOOK &&
    !webhookEnabled;
  const entries = Object.values(CLIENT_PROVIDERS).filter(
    (e) =>
      e.shared.action !== TriggerAction.SEND_WEBHOOK ||
      (webhookEnabled && source !== "report") ||
      (preserveHiddenWebhook && e.shared.action === value),
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
        webhookEnabled
          ? "Where the notification goes and what it sends. Notify channels post to Slack, send email, or call an endpoint. Actions add matching traces to a dataset or annotation queue."
          : "Where the notification goes and what it sends. Notify channels post to Slack or send email. Actions add matching traces to a dataset or annotation queue."
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
              webhookEnabled
                ? "Tell someone through Slack, email, or an endpoint."
                : "Tell someone through Slack or email."
            }
            entries={notify}
            value={value}
            onChange={pick}
            isAlertKind={isAlertKind}
            accent={accent}
            webhookEnabled={webhookEnabled}
            readOnlyAction={webhookReadOnly ? TriggerAction.SEND_WEBHOOK : null}
          />
        ) : null}
        {action.length > 0 && !notifyOnly ? (
          <DeliveryGroup
            label="Action"
            description="Do something to the matched trace."
            entries={action}
            value={value}
            onChange={pick}
            isAlertKind={isAlertKind}
            accent={accent}
            webhookEnabled={webhookEnabled}
            readOnlyAction={null}
          />
        ) : null}
        {webhookReadOnly ? (
          <Box
            padding={2.5}
            borderRadius="md"
            borderWidth="1px"
            colorPalette="orange"
            borderColor="colorPalette.muted"
            bg="colorPalette.subtle"
          >
            <Text textStyle="sm">
              Webhook delivery is unavailable for this project. This saved setup
              is read-only. Choose another channel to replace it.
            </Text>
          </Box>
        ) : null}
        {value && !webhookReadOnly ? (
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
  isAlertKind,
  accent,
  webhookEnabled,
  readOnlyAction,
}: {
  label: string;
  description: string;
  entries: ClientEntry[];
  value: TriggerAction | null;
  onChange: (action: TriggerAction) => void;
  isAlertKind: boolean;
  accent: string;
  webhookEnabled: boolean;
  readOnlyAction: TriggerAction | null;
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
            webhookEnabled={webhookEnabled}
            readOnly={entry.shared.action === readOnlyAction}
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
  webhookEnabled,
  readOnly,
}: {
  entry: ClientEntry;
  active: boolean;
  onClick: () => void;
  isAlertKind: boolean;
  accent: string;
  webhookEnabled: boolean;
  readOnly: boolean;
}) {
  const Icon = entry.client.Icon;
  const description =
    !webhookEnabled && entry.shared.action === TriggerAction.SEND_SLACK_MESSAGE
      ? isAlertKind
        ? "Post a message to Slack when the alert fires."
        : "Post a message to Slack when a trace matches."
      : isAlertKind
        ? (entry.shared.alertDescription ?? entry.shared.description)
        : entry.shared.description;
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
      cursor={readOnly ? "not-allowed" : "pointer"}
      aria-disabled={readOnly || undefined}
      onClick={readOnly ? undefined : onClick}
    >
      <HStack gap={2} mb={1}>
        <Icon size={18} />
        <Text fontWeight="semibold">{entry.shared.label}</Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {description}
      </Text>
    </chakra.button>
  );
}
