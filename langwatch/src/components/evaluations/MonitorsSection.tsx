import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Heading,
  IconButton,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import type { Check } from "@prisma/client";
import { useState } from "react";
import { Menu } from "../../components/ui/menu";
import { CustomGraph } from "../analytics/CustomGraph";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import {
  LuChevronDown,
  LuChevronUp,
  LuEllipsis,
  LuPencil,
  LuPlus,
} from "react-icons/lu";
import { TeamRoleGroup } from "../../server/api/permission";
import { Link } from "../ui/link";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

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

  const { project, hasTeamPermission } = useOrganizationTeamProject();

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
            {isCollapsed ? (
              <LuChevronDown size={16} />
            ) : (
              <LuChevronUp size={16} />
            )}
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
                          <LuEllipsis size={16} />
                        </IconButton>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="edit"
                          onClick={() => onEditMonitor(evaluation.id)}
                        >
                          <LuPencil size={16} />
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
                        monitorGraph: {
                          disabled: !evaluation.enabled,
                          isGuardrail:
                            evaluation.executionMode === "AS_GUARDRAIL",
                        },
                      }}
                    />
                  </Box>
                );
              })}
            </SimpleGrid>
            {evaluations.length === 0 && (
              <Text color="gray.600">
                No real-time monitors or guardrails set up yet.
                {project &&
                  hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
                    <>
                      {" "}
                      Click on{" "}
                      <Link
                        textDecoration="underline"
                        href={`/${project.slug}/evaluations/wizard`}
                      >
                        New Evaluation
                      </Link>{" "}
                      to get started.
                    </>
                  )}
              </Text>
            )}
          </>
        )}
      </Card.Body>
    </Card.Root>
  );
};
