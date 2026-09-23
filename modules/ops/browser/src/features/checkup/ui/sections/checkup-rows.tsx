import { Button, HStack, Input, Link, Text, VStack } from "@chakra-ui/react";
import type { CheckGroup, CheckRow as CheckRowData } from "@langwatch/ops-contract";
import { Activity, Cloud, ExternalLink, Plug, Server } from "lucide-react";
import type { ReactNode } from "react";

import { CheckRow } from "../blocks/check-row.tsx";
import { CheckupSection } from "../elements/checkup-section.tsx";

/**
 * The four bands, in the order an operator reads them. A band holding checks
 * that cost egress or money carries the button that runs them; the others
 * ran on load.
 */
const GROUPS: readonly { id: CheckGroup; title: string; description: string; icon: ReactNode }[] = [
  {
    id: "install",
    title: "Install",
    description: "The release, the data stores and the gateway this install runs on.",
    icon: <Server size={18} />,
  },
  {
    id: "langwatch",
    title: "LangWatch",
    description: "The license, the connection to LangWatch, and the daily report.",
    icon: <Cloud size={18} />,
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "Storage, email and the model providers this install calls.",
    icon: <Plug size={18} />,
  },
  {
    id: "pipelines",
    title: "Pipelines",
    description: "Canaries that send one real trace, evaluation, scenario or turn.",
    icon: <Activity size={18} />,
  },
];

export function CheckupRows({
  rows,
  ranAt,
  canManage,
  isRunning,
  runPlanId,
  onRunPlanIdChange,
  onRun,
}: {
  rows: CheckRowData[];
  ranAt: string;
  canManage: boolean;
  isRunning: boolean;
  runPlanId: string;
  onRunPlanIdChange: (value: string) => void;
  onRun: (group: CheckGroup) => void;
}) {
  return (
    <VStack width="full" align="stretch" gap={0}>
      <Text fontSize="sm" color="fg.muted" paddingBottom={2}>
        Checked at {ranAt}. Live queues, errors and throughput are on the{" "}
        <Link href="/ops" color="blue.600">
          ops dashboard <ExternalLink size={12} />
        </Link>
        .
      </Text>
      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group.id);
        if (groupRows.length === 0) return null;
        const hasExplicit = groupRows.some((row) => row.cost !== "free");
        return (
          <CheckupSection
            key={group.id}
            icon={group.icon}
            title={group.title}
            description={group.description}
            testId={`checkup-group-${group.id}`}
            action={
              hasExplicit ? (
                <HStack gap={2}>
                  {group.id === "pipelines" ? (
                    <Input
                      size="sm"
                      width="220px"
                      placeholder="Scenario run plan id or slug"
                      aria-label="Scenario run plan id or slug"
                      value={runPlanId}
                      onChange={(event) => onRunPlanIdChange(event.target.value)}
                      disabled={!canManage || isRunning}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canManage}
                    loading={isRunning}
                    onClick={() => onRun(group.id)}
                    data-testid={`checkup-run-${group.id}`}
                  >
                    {runLabel(group.id)}
                  </Button>
                </HStack>
              ) : undefined
            }
          >
            <VStack width="full" align="stretch" gap={2}>
              {groupRows.map((row) => (
                <CheckRow key={row.id} row={row} />
              ))}
            </VStack>
          </CheckupSection>
        );
      })}
    </VStack>
  );
}

function runLabel(group: CheckGroup): string {
  switch (group) {
    case "langwatch":
      return "Run connection checks";
    case "integrations":
      return "Run integration checks";
    case "pipelines":
      return "Run canaries";
    default:
      return "Run";
  }
}
