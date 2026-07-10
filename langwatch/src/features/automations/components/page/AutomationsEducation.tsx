import { SimpleGrid, Text, VStack } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import {
  AlertTriangle,
  Database,
  DollarSign,
  Edit3,
  Flag,
  TrendingDown,
} from "react-feather";

export type AutomationKind = "alert" | "automation";

/** Drawer params a use-case card seeds into a fresh create. Matches the
 *  `initial*` props on `AutomationDrawer` — nothing here locks anything.
 *  Alerts leave the graph for the user (we can't know which one); trace
 *  cards seed their filters too so the example arrives working, not as an
 *  empty shell. `initialFilters` is a JSON-encoded trigger filter object —
 *  the same shape the drawer persists — kept as a string so it survives
 *  the drawer's URL round-trip. */
export interface UseCasePrefill {
  initialSource?: "customGraph";
  initialName: string;
  initialAction: TriggerAction;
  initialFilters?: string;
}

const ERROR_TRACES_FILTER = JSON.stringify({ "traces.error": ["true"] });

interface UseCase {
  title: string;
  description: string;
  icon: typeof Flag;
  prefill: UseCasePrefill;
}

const USE_CASES: Record<AutomationKind, UseCase[]> = {
  alert: [
    {
      title: "Error spike",
      description: "Notify Slack when errors exceed a threshold.",
      icon: AlertTriangle,
      prefill: {
        initialSource: "customGraph",
        initialName: "Error spike alert",
        initialAction: "SEND_SLACK_MESSAGE",
      },
    },
    {
      title: "Traffic drop",
      description: "Know when traces stop arriving.",
      icon: TrendingDown,
      prefill: {
        initialSource: "customGraph",
        initialName: "Traffic drop alert",
        initialAction: "SEND_EMAIL",
      },
    },
    {
      title: "Cost spike",
      description: "Watch spend on a cost graph.",
      icon: DollarSign,
      prefill: {
        initialSource: "customGraph",
        initialName: "Cost spike alert",
        initialAction: "SEND_EMAIL",
      },
    },
  ],
  automation: [
    {
      title: "Flag failing evaluations",
      description: "Get a Slack message for every failure.",
      icon: Flag,
      prefill: {
        initialName: "Failing evaluations",
        initialAction: "SEND_SLACK_MESSAGE",
      },
    },
    {
      title: "Build a dataset from errors",
      description: "Collect errored traces into a dataset.",
      icon: Database,
      prefill: {
        initialName: "Error dataset",
        initialAction: "ADD_TO_DATASET",
        initialFilters: ERROR_TRACES_FILTER,
      },
    },
    {
      title: "Queue for review",
      description: "Send errored traces to your annotators.",
      icon: Edit3,
      prefill: {
        initialName: "Review queue",
        initialAction: "ADD_TO_ANNOTATION_QUEUE",
        initialFilters: ERROR_TRACES_FILTER,
      },
    },
  ],
};

function UseCaseCard({
  useCase,
  onOpen,
}: {
  useCase: UseCase;
  onOpen: (prefill: UseCasePrefill) => void;
}) {
  const Icon = useCase.icon;
  return (
    <VStack
      as="button"
      align="start"
      gap={1}
      padding={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="bg.panel"
      cursor="pointer"
      textAlign="left"
      _hover={{ bg: "bg.muted", borderColor: "border.emphasized" }}
      onClick={() => onOpen(useCase.prefill)}
    >
      <Text
        textStyle="sm"
        fontWeight="semibold"
        display="inline-flex"
        alignItems="center"
        gap={2}
      >
        <Icon size={14} />
        {useCase.title}
      </Text>
      <Text textStyle="sm" color="fg.muted">
        {useCase.description}
      </Text>
    </VStack>
  );
}

/**
 * Empty-state strip for a section on the Alerts & automations page: three
 * clickable examples that open the drawer pre-filled with a name, kind, and
 * action. Graph and filters stay with the user. Sections with rows don't
 * render this — the header's add button is the create entry point there.
 */
export function UseCaseStrip({
  kind,
  onOpen,
}: {
  kind: AutomationKind;
  onOpen: (prefill: UseCasePrefill) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
        Popular uses
      </Text>
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
        {USE_CASES[kind].map((useCase) => (
          <UseCaseCard key={useCase.title} useCase={useCase} onOpen={onOpen} />
        ))}
      </SimpleGrid>
    </VStack>
  );
}
