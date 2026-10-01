/**
 * The card a `langwatch trigger` result draws: what the automation is, what it
 * watches, where it delivers, whether it runs and when it next acts, with the
 * way into Automations. A list draws one row per automation. A result that is
 * not an automation (a test fire, a fire history) keeps the declarative card.
 * Spec: specs/langy/langy-automations.feature.
 */
import { HStack, Text, VStack } from "@chakra-ui/react";
import {
  useLangyAutomationNow,
  useLangySlackConnections,
} from "../../hooks/useLangyAutomationData";
import {
  automationCondition,
  automationDestinations,
  automationKind,
  type LangyAutomationRecord,
  mergeAutomation,
  nextFiringLine,
  readAutomations,
} from "../../logic/langyAutomationSummary";
import {
  buildResourceHref,
  type CapabilityCardInput,
  type CapabilityTone,
} from "../capabilities/capabilityRegistry";
import {
  CapabilityRow,
  LangyCapabilityCard,
} from "../capabilities/LangyCapabilityCard";
import { LangyDeclarativeCard } from "../capabilities/LangyDeclarativeCard";
import {
  AutomationDestinations,
  AutomationField,
  AutomationState,
} from "./LangyAutomationParts";

/** Verbs whose result is one automation, and how the card titles each. */
const SINGLE_VERBS: Record<string, { word: string; tone: CapabilityTone }> = {
  get: { word: "", tone: "read" },
  create: { word: "New", tone: "created" },
  update: { word: "Updated", tone: "updated" },
  disable: { word: "Paused", tone: "updated" },
  enable: { word: "Resumed", tone: "updated" },
};

const KIND_NOUN = {
  alert: "alert",
  automation: "automation",
  report: "report",
};

/** Where one automation opens: its view drawer on the Automations page. */
function automationHref({
  projectSlug,
  automationId,
}: {
  projectSlug: string | null;
  automationId: string;
}): string | null {
  return buildResourceHref({
    surface: "automations",
    projectSlug,
    resourceId: automationId,
  });
}

export function LangyAutomationCard(props: CapabilityCardInput) {
  const verb = props.descriptor.command.verb;
  const automations = readAutomations(props.output);
  if (verb === "list") {
    return <AutomationListCard automations={automations} {...props} />;
  }
  const single = SINGLE_VERBS[verb];
  const [stated] = automations;
  if (!single || !stated) return <LangyDeclarativeCard {...props} />;
  return (
    <SingleAutomationCard
      stated={stated}
      word={single.word}
      tone={single.tone}
      projectSlug={props.projectSlug ?? null}
    />
  );
}

function SingleAutomationCard({
  stated,
  word,
  tone,
  projectSlug,
}: {
  stated: LangyAutomationRecord;
  word: string;
  tone: CapabilityTone;
  projectSlug: string | null;
}) {
  const { fresh, nextFiring } = useLangyAutomationNow(stated.id);
  const { connections } = useLangySlackConnections();
  const automation = mergeAutomation({ stated, fresh });
  const kind = automationKind(automation);
  const condition = automationCondition(automation);
  const noun = KIND_NOUN[kind];
  const destinations = automationDestinations({
    record: automation,
    slackConnections: connections,
  });
  return (
    <LangyCapabilityCard
      tone={tone}
      surface="automations"
      overline={word ? `${word} ${noun}` : noun}
      title={<AutomationTitle automation={automation} />}
      projectSlug={projectSlug}
      deepLinkHref={automationHref({ projectSlug, automationId: stated.id })}
    >
      <VStack align="stretch" gap={1.5} data-testid="langy-automation-card">
        {condition ? (
          <AutomationField label="Watches">
            <Text textStyle="sm" overflowWrap="anywhere">
              {condition}
            </Text>
          </AutomationField>
        ) : null}
        {destinations.length > 0 ? (
          <AutomationField label="Delivers">
            <AutomationDestinations destinations={destinations} />
          </AutomationField>
        ) : null}
        {nextFiring ? (
          <AutomationField label="Next">
            <Text
              textStyle="sm"
              color="fg.muted"
              data-testid="langy-automation-next"
            >
              {nextFiringLine(nextFiring)}
            </Text>
          </AutomationField>
        ) : null}
      </VStack>
    </LangyCapabilityCard>
  );
}

function AutomationTitle({
  automation,
}: {
  automation: LangyAutomationRecord;
}) {
  return (
    <HStack gap={2} align="center" justify="space-between" minWidth={0}>
      <Text textStyle="sm" fontWeight="medium" color="fg" truncate>
        {automation.name}
      </Text>
      {automation.active === undefined ? null : (
        <AutomationState active={automation.active} />
      )}
    </HStack>
  );
}

function AutomationListCard({
  automations,
  descriptor,
  projectSlug,
}: CapabilityCardInput & { automations: LangyAutomationRecord[] }) {
  const { connections } = useLangySlackConnections();
  const count = automations.length;
  const running = automations.filter((a) => a.active !== false).length;
  return (
    <LangyCapabilityCard
      tone="read"
      surface="automations"
      overline={descriptor.overline}
      title={
        count === 0
          ? "No automations yet"
          : `${count} ${count === 1 ? "automation" : "automations"} · ${running} active`
      }
      projectSlug={projectSlug}
    >
      {count > 0 ? (
        <VStack align="stretch" gap={0} data-testid="langy-automation-list">
          {automations.slice(0, 6).map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              connections={connections}
              projectSlug={projectSlug ?? null}
            />
          ))}
        </VStack>
      ) : null}
    </LangyCapabilityCard>
  );
}

function AutomationRow({
  automation,
  connections,
  projectSlug,
}: {
  automation: LangyAutomationRecord;
  connections: ReadonlyArray<{ id: string; name: string }> | undefined;
  projectSlug: string | null;
}) {
  const [destination] = automationDestinations({
    record: automation,
    slackConnections: connections,
  });
  const where = destination
    ? [destination.label, destination.detail].filter(Boolean).join(" ")
    : null;
  const kind = automationKind(automation);
  return (
    <CapabilityRow
      href={automationHref({ projectSlug, automationId: automation.id })}
      primary={
        <HStack as="span" gap={2} justify="space-between">
          <Text as="span" truncate>
            {automation.name}
          </Text>
          <AutomationState active={automation.active !== false} />
        </HStack>
      }
      secondary={[KIND_NOUN[kind], automationCondition(automation), where]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}
