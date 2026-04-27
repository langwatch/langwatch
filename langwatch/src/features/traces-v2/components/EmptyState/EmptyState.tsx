import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  BookOpen,
  Key,
  PartyPopper,
  Play,
  Terminal,
  Variable,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link } from "~/components/ui/link";

interface EmptyStateProps {
  settingsHref: string;
  onLoadDemoData: () => void;
}

/**
 * Demo mode indicator — shown at the top of the page when viewing sample data.
 */
export const DemoModeBanner: React.FC<{ onExit: () => void }> = ({
  onExit,
}) => {
  return (
    <Flex
      align="center"
      justify="center"
      gap={2}
      paddingY={1.5}
      bg="yellow.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
    >
      <Text textStyle="xs" color="yellow.fg" fontWeight="medium">
        Viewing sample data
      </Text>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="yellow"
        onClick={onExit}
      >
        Exit demo
        <Icon boxSize={3}>
          <X />
        </Icon>
      </Button>
    </Flex>
  );
};

/**
 * Celebration banner — shown when the first real traces arrive.
 */
export const CelebrationBanner: React.FC<{ onDismiss: () => void }> = ({
  onDismiss,
}) => {
  return (
    <Flex
      align="center"
      justify="center"
      gap={2}
      paddingY={2}
      bg="green.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
    >
      <Icon boxSize={4} color="green.fg">
        <PartyPopper />
      </Icon>
      <Text textStyle="sm" color="green.fg" fontWeight="medium">
        Your first traces are here!
      </Text>
      <Text textStyle="xs" color="green.fg">
        Your integration is working. Traces will appear in real-time.
      </Text>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="green"
        onClick={onDismiss}
        marginLeft={2}
      >
        Dismiss
      </Button>
    </Flex>
  );
};

export const EmptyState: React.FC<EmptyStateProps> = ({ settingsHref, onLoadDemoData }) => {
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

const SkillsCard: React.FC<{ settingsHref: string }> = ({ settingsHref }) => {
  return (
    <Card.Root flex={1} variant="outline">
      <Card.Header>
        <HStack gap={2}>
          <Terminal size={16} />
          <Heading size="sm">Set up with Skills</Heading>
        </HStack>
        <Badge size="sm" colorPalette="green" variant="subtle">
          Recommended
        </Badge>
      </Card.Header>
      <Card.Body>
        <VStack align="start" gap={4}>
          <SetupStep
            number={1}
            icon={<Key size={14} />}
            title="Create an API key"
            description={
              <Link href={settingsHref} variant="underline" colorPalette="blue">
                Go to project settings
              </Link>
            }
          />
          <SetupStep
            number={2}
            icon={<Variable size={14} />}
            title="Set environment variables"
            description={
              <Box
                as="pre"
                fontSize="xs"
                bg="bg.subtle"
                padding={2}
                borderRadius="md"
                width="full"
                overflowX="auto"
                fontFamily="mono"
              >
                {`LANGWATCH_API_KEY=your-key\nLANGWATCH_ENDPOINT=https://...`}
              </Box>
            }
          />
          <SetupStep
            number={3}
            icon={<Terminal size={14} />}
            title="Run the setup skill"
            description={
              <Text color="fg.muted" textStyle="xs">
                Run the LangWatch setup skill in Claude Code or your IDE
              </Text>
            }
          />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
};

const ManualIntegrationCard: React.FC = () => {
  return (
    <Card.Root flex={1} variant="outline">
      <Card.Header>
        <HStack gap={2}>
          <BookOpen size={16} />
          <Heading size="sm">Manual integration</Heading>
        </HStack>
      </Card.Header>
      <Card.Body>
        <VStack align="start" gap={3}>
          <Text color="fg.muted" textStyle="sm">
            Integrate using our SDKs and follow the docs for your framework.
          </Text>
          <HStack gap={2} flexWrap="wrap">
            <Badge variant="outline" size="sm">Python</Badge>
            <Badge variant="outline" size="sm">TypeScript</Badge>
            <Badge variant="outline" size="sm">LangChain</Badge>
            <Badge variant="outline" size="sm">OpenAI</Badge>
            <Badge variant="outline" size="sm">Vercel AI</Badge>
          </HStack>
          <Link
            href="https://docs.langwatch.ai"
            variant="underline"
            colorPalette="blue"
            textStyle="sm"
          >
            View integration docs
          </Link>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
};

interface SetupStepProps {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}

const SetupStep: React.FC<SetupStepProps> = ({
  number,
  icon,
  title,
  description,
}) => {
  return (
    <HStack align="start" gap={3} width="full">
      <Box
        flexShrink={0}
        width="20px"
        height="20px"
        borderRadius="full"
        bg="bg.emphasized"
        display="flex"
        alignItems="center"
        justifyContent="center"
        textStyle="xs"
        fontWeight="bold"
        color="fg.muted"
      >
        {number}
      </Box>
      <VStack align="start" gap={1} flex={1}>
        <HStack gap={1.5}>
          <Box color="fg.muted">{icon}</Box>
          <Text textStyle="sm" fontWeight="medium">
            {title}
          </Text>
        </HStack>
        {description}
      </VStack>
    </HStack>
  );
};
