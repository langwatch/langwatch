import { Badge, Box, Card, HStack, Heading, Text, VStack } from "@chakra-ui/react";
import { Key, Terminal, Variable } from "lucide-react";
import { Link } from "~/components/ui/link";
import { SetupStep } from "./SetupStep";

interface SkillsCardProps {
  settingsHref: string;
}

const ENV_VAR_SNIPPET = `LANGWATCH_API_KEY=your-key
LANGWATCH_ENDPOINT=https://...`;

export const SkillsCard = ({ settingsHref }: SkillsCardProps) => {
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
                textStyle="xs"
                bg="bg.subtle"
                padding={2}
                borderRadius="md"
                width="full"
                overflowX="auto"
                fontFamily="mono"
              >
                {ENV_VAR_SNIPPET}
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
