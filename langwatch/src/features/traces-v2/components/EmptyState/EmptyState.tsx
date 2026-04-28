import {
  Box,
  Button,
  HStack,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Play } from "lucide-react";
import { ManualIntegrationCard } from "./ManualIntegrationCard";
import { SkillsCard } from "./SkillsCard";

interface EmptyStateProps {
  settingsHref: string;
  onLoadDemoData: () => void;
}

export const EmptyState = ({ settingsHref, onLoadDemoData }: EmptyStateProps) => {
  return (
    <VStack
      flex={1}
      justify="center"
      align="center"
      padding={8}
      minHeight="60vh"
    >
      <VStack gap={6} maxWidth="640px" textAlign="center">
        <VStack gap={2}>
          <Heading size="lg">No traces yet</Heading>
          <Text color="fg.muted" textStyle="md">
            Traces show you what your AI agents are doing: every LLM call, tool
            use, and decision they make.
          </Text>
        </VStack>

        <HStack gap={4} width="full" align="stretch">
          <SkillsCard settingsHref={settingsHref} />
          <ManualIntegrationCard />
        </HStack>

        <HStack width="full" align="center" gap={3}>
          <Box flex={1} height="1px" bg="border.muted" />
          <Text color="fg.subtle" textStyle="xs">
            or
          </Text>
          <Box flex={1} height="1px" bg="border.muted" />
        </HStack>

        <Button variant="ghost" size="sm" onClick={onLoadDemoData}>
          <Play size={14} />
          Explore with sample data
        </Button>
      </VStack>
    </VStack>
  );
};
