import {
  Badge,
  Box,
  Card,
  HStack,
  Heading,
  IconButton,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import type { Check } from "@prisma/client";
import { useState } from "react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "react-feather";
import { Menu } from "../../components/ui/menu";
import { CustomGraph } from "../analytics/CustomGraph";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";

type MonitorsSectionProps = {
  title: string;
  evaluations: Check[];
  onEditMonitor: (monitorId: string) => void;
};

export const MonitorsSection = ({
  title,
  evaluations,
  onEditMonitor,
}: MonitorsSectionProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <Card.Root mb={8}>
      <Card.Body>
        <HStack justify="space-between" mb={4}>
          <HStack gap={2}>
            <Heading size="md">{title}</Heading>
            <Badge variant="outline" px={2} py={1}>
              {evaluations.length} Active
            </Badge>
          </HStack>
          <IconButton
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </IconButton>
        </HStack>

        {!isCollapsed && (
          <>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
              {evaluations.map((evaluation) => {
                const evaluatorDefinition = getEvaluatorDefinitions(
                  evaluation.checkType
                );
                // TODO: handle custom evaluators

                return (
                  <Box key={evaluation.id} position="relative">
                    <Menu.Root>
                      <Menu.Trigger
                        asChild
                        position="absolute"
                        top={4}
                        right={4}
                        zIndex={2}
                      >
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="More options"
                        >
                          <MoreHorizontal size={16} />
                        </IconButton>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="edit"
                          onClick={() => onEditMonitor(evaluation.id)}
                        >
                          Edit
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                    <CustomGraph
                      input={{
                        graphId: evaluation.id,
                        graphType: "monitor_graph",
                        series: [
                          {
                            aggregation: "avg",
                            colorSet: "tealTones",
                            key: evaluation.id,
                            metric: evaluatorDefinition?.isGuardrail
                              ? "evaluations.evaluation_pass_rate"
                              : "evaluations.evaluation_score",
                            name: evaluation.name,
                          },
                        ],
                        includePrevious: false,
                        timeScale: 1,
                        height: 140,
                        disabled: !evaluation.enabled,
                      }}
                    />
                  </Box>
                );
              })}
            </SimpleGrid>
          </>
        )}
      </Card.Body>
    </Card.Root>
  );
};
