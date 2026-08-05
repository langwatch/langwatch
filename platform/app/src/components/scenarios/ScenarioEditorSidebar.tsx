import { Card, HStack, Icon, List, Text, VStack } from "@chakra-ui/react";
import {
  Check,
  CircleDot,
  MessageSquare,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { ScenarioAIGeneration } from "./ScenarioAIGeneration";
import type { ScenarioFormData } from "./ScenarioForm";

type ScenarioEditorSidebarProps = {
  form?: UseFormReturn<ScenarioFormData> | null;
};

/**
 * Help sidebar for the scenario editor.
 * Provides tips and best practices for writing scenarios.
 */
export function ScenarioEditorSidebar({ form }: ScenarioEditorSidebarProps) {
  return (
    <VStack align="stretch" gap={4}>
      {/* AI Generation */}
      <ScenarioAIGeneration form={form ?? null} />

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
                  <Text fontSize="xs" color="fg.muted">
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
                  <Text fontSize="xs" color="fg.muted">
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
                  <Text fontSize="xs" color="fg.muted">
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
                  <Text fontSize="xs" color="fg.muted">
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
              <List.Item fontSize="xs" color="fg.muted">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Start with small simulations to validate quickly
              </List.Item>
              <List.Item fontSize="xs" color="fg.muted">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Use specific prompts for better results
              </List.Item>
              <List.Item fontSize="xs" color="fg.muted">
                <List.Indicator asChild color="blue.500">
                  <Check size={14} />
                </List.Indicator>
                Include edge cases in your testing
              </List.Item>
              <List.Item fontSize="xs" color="fg.muted">
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
