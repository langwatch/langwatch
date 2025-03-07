import { useState } from "react";
import {
  Box,
  Button,
  Card,
  HStack,
  Heading,
  Text,
  VStack,
  Badge,
  IconButton,
  SimpleGrid,
} from "@chakra-ui/react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "react-feather";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { getStatusColor, getStatusIcon, getChartColor } from "./utils";
import { Menu } from "../../components/ui/menu";

type Monitor = {
  id: string;
  name: string;
  type: string;
  metric: string;
  value: number;
  status: "error" | "warning" | "healthy";
  lastUpdated: string;
  history: { time: string; value: number }[];
};

type MonitorsSectionProps = {
  title: string;
  description: string;
  monitors: Monitor[];
  onEditMonitor: (monitorId: string) => void;
};

export const MonitorsSection = ({ title, description, monitors, onEditMonitor }: MonitorsSectionProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <Card.Root mb={8}>
      <Card.Body>
        <HStack justify="space-between" mb={4}>
          <HStack gap={2}>
            <Heading size="md">{title}</Heading>
            <Badge variant="outline" px={2} py={1}>
              {monitors.length} Active
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
            <Text color="gray.600" mb={4}>
              {description}
            </Text>

            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
              {monitors.map((monitor) => {
                const statusColor = getStatusColor(monitor.status, monitor.value);
                const statusIcon = getStatusIcon(monitor.status, monitor.value);
                const chartColor = getChartColor(monitor.status, monitor.value);

                return (
                  <Card.Root
                    key={monitor.id}
                    position="relative"
                    overflow="hidden"
                    bg={statusColor.bg}
                    color={statusColor.color}
                    borderColor={statusColor.borderColor}
                    borderWidth="1px"
                    _hover={{ shadow: "sm" }}
                    height="full"
                  >
                    <Card.Body>
                      {/* Background Chart */}
                      <Box position="absolute" inset={0} opacity={0.15} pointerEvents="none">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={monitor.history}>
                            <defs>
                              <linearGradient id={`color-${monitor.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={chartColor} stopOpacity={0.8} />
                                <stop offset="100%" stopColor={chartColor} stopOpacity={0.2} />
                              </linearGradient>
                            </defs>
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke={chartColor}
                              fill={`url(#color-${monitor.id})`}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </Box>

                      <VStack align="start" gap={2} position="relative" zIndex={1} height="full">
                        <HStack width="full" justify="space-between">
                          <Text fontWeight="medium" fontSize="sm">
                            {monitor.name}
                          </Text>
                          <HStack gap={2}>
                            <Box>{statusIcon}</Box>
                            <Menu.Root>
                              <Menu.Trigger asChild>
                                <IconButton
                                  variant="ghost"
                                  size="sm"
                                  aria-label="More options"
                                >
                                  <MoreHorizontal size={16} />
                                </IconButton>
                              </Menu.Trigger>
                              <Menu.Content>
                                <Menu.Item value="edit" onClick={() => onEditMonitor(monitor.id)}>
                                  Edit
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Root>
                          </HStack>
                        </HStack>

                        <VStack align="start" gap={1} mt="auto">
                          <HStack>
                            <Text fontSize="2xl" fontWeight="bold" mr={1}>
                              {(monitor.value * 100).toFixed(0)}%
                            </Text>
                            <Text fontSize="xs">{monitor.metric}</Text>
                          </HStack>
                          <Text fontSize="xs" opacity={0.7}>
                            Updated {monitor.lastUpdated}
                          </Text>
                        </VStack>
                      </VStack>
                    </Card.Body>
                  </Card.Root>
                );
              })}
            </SimpleGrid>
          </>
        )}
      </Card.Body>
    </Card.Root>
  );
};