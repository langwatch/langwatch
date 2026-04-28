import { Badge, Card, HStack, Heading, Text, VStack } from "@chakra-ui/react";
import { BookOpen } from "lucide-react";
import { Link } from "~/components/ui/link";

const SUPPORTED_FRAMEWORKS = [
  "Python",
  "TypeScript",
  "LangChain",
  "OpenAI",
  "Vercel AI",
] as const;

const DOCS_URL = "https://docs.langwatch.ai";

export const ManualIntegrationCard = () => {
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
            {SUPPORTED_FRAMEWORKS.map((framework) => (
              <Badge key={framework} variant="outline" size="sm">
                {framework}
              </Badge>
            ))}
          </HStack>
          <Link
            href={DOCS_URL}
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
