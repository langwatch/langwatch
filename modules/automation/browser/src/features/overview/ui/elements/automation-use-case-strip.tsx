import { TriggerAction } from "@langwatch/automation-contract";
import { Card } from "@langwatch/design-system/card";
import { SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import { AlertTriangle, Database, DollarSign, Edit3, Flag, TrendingDown } from "lucide-react";

export type AutomationUseCaseKind = "alert" | "automation";

export type AutomationUseCasePrefill = {
  initialSource?: "customGraph";
  initialName: string;
  initialAction: TriggerAction;
  initialFilters?: string;
};

const ERROR_TRACES_FILTER = JSON.stringify({ "traces.error": ["true"] });

type UseCase = {
  title: string;
  description: string;
  icon: typeof Flag;
  prefill: AutomationUseCasePrefill;
};

const USE_CASES: Record<AutomationUseCaseKind, UseCase[]> = {
  alert: [
    {
      title: "Error spike",
      description: "Notify Slack when errors exceed a threshold.",
      icon: AlertTriangle,
      prefill: {
        initialSource: "customGraph",
        initialName: "Error spike",
        initialAction: TriggerAction.SEND_SLACK_MESSAGE,
      },
    },
    {
      title: "Traffic drop",
      description: "Know when traces stop arriving.",
      icon: TrendingDown,
      prefill: {
        initialSource: "customGraph",
        initialName: "Traffic drop",
        initialAction: TriggerAction.SEND_EMAIL,
      },
    },
    {
      title: "Cost spike",
      description: "Watch spend on a cost graph.",
      icon: DollarSign,
      prefill: {
        initialSource: "customGraph",
        initialName: "Cost spike",
        initialAction: TriggerAction.SEND_EMAIL,
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
        initialAction: TriggerAction.SEND_SLACK_MESSAGE,
      },
    },
    {
      title: "Build a dataset from errors",
      description: "Collect errored traces into a dataset.",
      icon: Database,
      prefill: {
        initialName: "Error dataset",
        initialAction: TriggerAction.ADD_TO_DATASET,
        initialFilters: ERROR_TRACES_FILTER,
      },
    },
    {
      title: "Queue for review",
      description: "Send errored traces to your annotators.",
      icon: Edit3,
      prefill: {
        initialName: "Review queue",
        initialAction: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
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
  onOpen: (prefill: AutomationUseCasePrefill) => void;
}) {
  const Icon = useCase.icon;

  return (
    <Card
      padding="sm"
      icon={<Icon size={14} />}
      title={useCase.title}
      titleLevel={3}
      description={useCase.description}
      opener={
        <button type="button" aria-label={useCase.title} onClick={() => onOpen(useCase.prefill)} />
      }
    />
  );
}

export function AutomationUseCaseStrip({
  kind,
  onOpen,
  showLabel = true,
}: {
  kind: AutomationUseCaseKind;
  onOpen: (prefill: AutomationUseCasePrefill) => void;
  showLabel?: boolean;
}) {
  return (
    <VStack align="stretch" gap={2}>
      {showLabel && (
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
          Popular uses
        </Text>
      )}
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
        {USE_CASES[kind].map((useCase) => (
          <UseCaseCard key={useCase.title} useCase={useCase} onOpen={onOpen} />
        ))}
      </SimpleGrid>
    </VStack>
  );
}
