import {
  Box,
  Button,
  Card,
  HStack,
  Icon,
  List,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Check,
  CircleDot,
  MessageSquare,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";

/**
 * Help sidebar for the scenario editor.
 * Provides tips and best practices for writing scenarios.
 */
export function ScenarioEditorSidebar() {
  return (
    <VStack align="stretch" gap={4}>
      {/* Need Help Card */}
      <Card.Root>
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <HStack gap={3}>
              <Box
                p={2}
                bg="blue.50"
                borderRadius="md"
                color="blue.500"
              >
                <Sparkles size={20} />
              </Box>
              <VStack align="start" gap={0}>
                <Text fontWeight="semibold" fontSize="sm">
                  Need Help?
                </Text>
                <Text fontSize="xs" color="gray.600">
                  Our AI can help you write better scenarios based on your
                  agent&apos;s purpose and common user patterns.
                </Text>
              </VStack>
            </HStack>
            <Button variant="outline" width="full" size="sm">
              <Sparkles size={14} />
              Generate with AI
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>

      {/* Writing Great Scenarios */}
      <Card.Root>
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <Text fontWeight="semibold" fontSize="sm">
              Writing Great Scenarios
            </Text>

            <VStack align="stretch" gap={3}>
              <HStack align="start" gap={3}>
                <Icon color="green.500" mt={0.5}>
                  <CircleDot size={16} />
                </Icon>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    Define Success Clearly
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    What does &apos;good&apos; look like? Be specific about
                    expected outcomes.
                  </Text>
                </VStack>
              </HStack>

              <HStack align="start" gap={3}>
                <Icon color="yellow.500" mt={0.5}>
                  <TriangleAlert size={16} />
                </Icon>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    Consider Edge Cases
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    What unusual situations should your agent handle?
                  </Text>
                </VStack>
              </HStack>

              <HStack align="start" gap={3}>
                <Icon color="purple.500" mt={0.5}>
                  <Users size={16} />
                </Icon>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    Think About Personas
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    Who are your users? Different users have different needs.
                  </Text>
                </VStack>
              </HStack>

              <HStack align="start" gap={3}>
                <Icon color="blue.500" mt={0.5}>
                  <MessageSquare size={16} />
                </Icon>
                <VStack align="start" gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    Conversation Flow
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    How should the conversation progress?
                  </Text>
                </VStack>
              </HStack>
            </VStack>
          </VStack>
        </Card.Body>
      </Card.Root>

      {/* Best Practices */}
      <Card.Root>
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <Text fontWeight="semibold" fontSize="sm">
              Best Practices
            </Text>

            <List.Root gap={2} listStyleType="none">
              <List.Item fontSize="xs" color="gray.600">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Start with small simulations to validate quickly
              </List.Item>
              <List.Item fontSize="xs" color="gray.600">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Use specific prompts for better results
              </List.Item>
              <List.Item fontSize="xs" color="gray.600">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Include edge cases in your testing
              </List.Item>
              <List.Item fontSize="xs" color="gray.600">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Review metrics after each run
              </List.Item>
            </List.Root>
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}




