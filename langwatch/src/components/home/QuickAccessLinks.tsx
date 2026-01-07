import {
  Box,
  Link as ChakraLink,
  Grid,
  Heading,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { LuExternalLink } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { featureIcons } from "~/utils/featureIcons";
import { Link } from "../ui/link";
import { HomeCard } from "./HomeCard";

type QuickAccessCard = {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  href: string;
  docsHref: string;
};

/**
 * Build quick access cards based on integration status
 */
export const buildQuickAccessCards = (
  projectSlug: string,
  isIntegrated: boolean,
): QuickAccessCard[] => {
  const tracesConfig = featureIcons.traces;
  const simulationsConfig = featureIcons.simulations;
  const promptsConfig = featureIcons.prompts;
  const evaluationsConfig = featureIcons.evaluations;

  return [
    {
      title: "Observability",
      description: isIntegrated
        ? "View your traces and monitor performance"
        : "Set up tracing for your AI application",
      icon: <Icon as={tracesConfig.icon} width="16px" height="16px" display="block" />,
      color: tracesConfig.color.split(".")[0] ?? "blue",
      href: isIntegrated
        ? `/${projectSlug}/messages`
        : `/${projectSlug}/messages`,
      docsHref: "https://langwatch.ai/docs/integration/quick-start",
    },
    {
      title: "Agent Simulations",
      description: "Test your AI agents with simulated conversations",
      icon: <Icon as={simulationsConfig.icon} width="16px" height="16px" display="block" />,
      color: simulationsConfig.color.split(".")[0] ?? "pink",
      href: `/${projectSlug}/simulations`,
      docsHref: "https://langwatch.ai/docs/agent-simulations/getting-started",
    },
    {
      title: "Prompt Management",
      description: "Version and manage your prompts",
      icon: <Icon as={promptsConfig.icon} width="16px" height="16px" display="block" />,
      color: promptsConfig.color.split(".")[0] ?? "purple",
      href: `/${projectSlug}/prompts`,
      docsHref: "https://langwatch.ai/docs/prompt-management/overview",
    },
    {
      title: "Evaluations",
      description: "Evaluate your agent or set up real-time evaluations",
      icon: <Icon as={evaluationsConfig.icon} width="16px" height="16px" display="block" />,
      color: evaluationsConfig.color.split(".")[0] ?? "orange",
      href: `/${projectSlug}/evaluations`,
      docsHref: "https://langwatch.ai/docs/llm-evaluation",
    },
  ];
};

type QuickAccessCardItemProps = {
  card: QuickAccessCard;
};

/**
 * Single quick access card
 */
function QuickAccessCardItem({ card }: QuickAccessCardItemProps) {
  return (
    <ChakraLink asChild _hover={{ textDecoration: "none" }} height="full">
      <NextLink href={card.href}>
        <HomeCard height="full" width="full" padding={3}>
          <HStack width="full">
            <Box
              padding={1.5}
              borderRadius="md"
              background={`${card.color}.50`}
              color={`${card.color}.500`}
            >
              {card.icon}
            </Box>
          </HStack>
          <VStack align="start" gap={1} flex={1}>
            <Text fontWeight="medium" fontSize="sm">
              {card.title}
            </Text>
            <Text fontSize="xs" color="gray.500" lineClamp={2}>
              {card.description}
            </Text>
          </VStack>
          <Link
            href={card.docsHref}
            isExternal
            fontSize="xs"
            color="gray.400"
            _hover={{ color: `${card.color}.500` }}
            onClick={(e) => e.stopPropagation()}
          >
            <HStack gap={1}>
              <Text>Docs</Text>
              <LuExternalLink size={10} />
            </HStack>
          </Link>
        </HomeCard>
      </NextLink>
    </ChakraLink>
  );
}

/**
 * QuickAccessLinks
 * Grid of feature cards for quick access to platform features.
 */
export function QuickAccessLinks() {
  const { project } = useOrganizationTeamProject();

  const { data: checkStatus } = api.integrationsChecks.getCheckStatus.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (!project) {
    return null;
  }

  const isIntegrated = checkStatus?.firstMessage ?? false;
  const cards = buildQuickAccessCards(project.slug, isIntegrated);

  return (
    <VStack data-tour-target="quick-access" align="stretch" gap={3} width="full">
      <Heading>What would you like to work on today?</Heading>
      <Grid
        templateColumns={{
          base: "1fr",
          sm: "repeat(2, 1fr)",
          lg: "repeat(4, 1fr)",
        }}
        gap={3}
      >
        {cards.map((card) => (
          <QuickAccessCardItem key={card.title} card={card} />
        ))}
      </Grid>
    </VStack>
  );
}
