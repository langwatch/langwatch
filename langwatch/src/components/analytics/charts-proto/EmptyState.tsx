/**
 * charts-proto — dashboard empty state (PROTOTYPE, strategy S4 on-ramp).
 *
 * Zero-to-useful: pick a curated template and a full dashboard appears, or start
 * from scratch with the builder.
 */
import { Box, Button, Card, Heading, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Plus } from "react-feather";
import { LuChartBar, LuCircleAlert, LuClock, LuDollarSign } from "react-icons/lu";
import type { DashboardTemplate } from "./templates";

const TEMPLATE_ICON: Record<string, React.ReactNode> = {
  cost: <LuDollarSign />,
  latency: <LuClock />,
  errors: <LuCircleAlert />,
  models: <LuChartBar />,
};

interface Props {
  templates: DashboardTemplate[];
  onPick: (template: DashboardTemplate) => void;
  onBuildOwn: () => void;
}

export function EmptyState({ templates, onPick, onBuildOwn }: Props) {
  return (
    <VStack gap={8} paddingY={10} align="stretch" maxWidth="900px" marginX="auto">
      <VStack gap={2} textAlign="center">
        <Heading size="lg">Build your first dashboard</Heading>
        <Text color="fg.muted" maxWidth="560px">
          Start from a template and tweak it, or add a widget and shape a trace
          query yourself. Every widget is a live view over your traces.
        </Text>
      </VStack>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
        {templates.map((template) => (
          <Card.Root
            key={template.key}
            variant="outline"
            cursor="pointer"
            transition="all 0.15s"
            _hover={{
              borderColor: "orange.400",
              transform: "translateY(-2px)",
              boxShadow: "sm",
            }}
            onClick={() => onPick(template)}
          >
            <Card.Body>
              <HStack gap={3} align="start">
                <Box
                  fontSize="xl"
                  color="orange.500"
                  background="orange.subtle"
                  borderRadius="md"
                  padding={2}
                  display="flex"
                >
                  {TEMPLATE_ICON[template.key]}
                </Box>
                <VStack align="start" gap={1} flex={1}>
                  <Heading size="sm">{template.name}</Heading>
                  <Text fontSize="sm" color="fg.muted">
                    {template.description}
                  </Text>
                  <Text fontSize="xs" color="fg.subtle" marginTop={1}>
                    {template.widgets.length} widgets
                  </Text>
                </VStack>
              </HStack>
            </Card.Body>
          </Card.Root>
        ))}
      </SimpleGrid>

      <HStack justify="center">
        <Button variant="outline" onClick={onBuildOwn}>
          <Plus size={16} /> Build your own
        </Button>
      </HStack>
    </VStack>
  );
}
