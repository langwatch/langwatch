import { Box, Heading, VStack, Text, HStack, Badge, Icon, Button, Circle, Link as ChakraLink } from "@chakra-ui/react";
import { LuBot, LuBookOpen, LuExternalLink, LuBotMessageSquare } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import React from "react";

interface SimulationButtonProps {
  href: string;
  color: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  external?: boolean;
}

const SimulationButton: React.FC<SimulationButtonProps> = ({ href, color, icon, label, description, external }) => (
  <Button
    asChild
    variant="outline"
    colorPalette={color}
    colorScheme={color}
    borderRadius="md"
    px={3}
    py={6}
    fontWeight="normal"
    display="flex"
    alignItems="center"
    textAlign="left"
    w="full"
    minH="48px"
    gap={3}
    aria-label={label + (external ? ' (opens in a new tab)' : '')}
  >
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{ display: "flex", alignItems: "center", width: "100%" }}
      aria-label={label + (external ? ' (opens in a new tab)' : '')}
    >
      <Circle size="26px" bg={`${color}.100`} color={`${color}.500`} flexShrink={0}>
        {icon}
      </Circle>
      <Box flex={1} display="flex" flexDirection="column" alignItems="flex-start" minW={0} ml={2}>
        <Text fontWeight="medium" textAlign="left">{label}</Text>
        <Text color="gray.500" fontSize="xs" mt={0.25} textAlign="left" maxW="100%" overflow="hidden" whiteSpace="nowrap" textOverflow="ellipsis">
          {description}
        </Text>
      </Box>
      <Box as="span" color="gray.400" ml={2} display="flex" alignItems="center">
        <LuExternalLink size={18} />
      </Box>
    </a>
  </Button>
);

const AgentSimulationTesting: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? "";
  return (
    <VStack
      minH="80px"
      boxShadow="sm"
      borderRadius="xl"
      p={4}
      gap={2}
      align="stretch"
      style={{
        background: `
          radial-gradient(ellipse 60% 80% at 20% 30%, rgba(255,229,180,0.35) 0%, transparent 85%),
          radial-gradient(ellipse 50% 60% at 80% 20%, rgba(224,215,255,0.32) 0%, transparent 85%),
          radial-gradient(ellipse 80% 100% at 50% 80%, rgba(255,255,255,0.85) 0%, transparent 90%)
        `
      }}
    >
      <VStack mb={1} align="start">
        <HStack gap={2}>
          <Icon color="orange.500" boxSize={5}><LuBot /></Icon>
          <Heading size="md" fontWeight="bold" textAlign="left">
            Agent Simulations
          </Heading>
          <Badge size="md" colorPalette="orange" variant="subtle" borderRadius="2xl">
            New
          </Badge>
        </HStack>
        <Text fontSize="xs" color="gray.500" textAlign="left">
          Test your AI agents with realistic scenarios and conversations. Create simulated
          interactions to evaluate performance before deployment.
        </Text>
      </VStack>
      <VStack w="full" align="stretch" gap={4} mt={2}>
        <SimulationButton
          href={`/${projectSlug}/simulations`}
          color="orange"
          icon={<LuBotMessageSquare size={14} color="orange.500" />}
          label="View your simulations"
          description="Explore, manage, and review your agent simulation sets"
        />
        <SimulationButton
          href="https://scenario.langwatch.ai"
          color="blue"
          icon={<LuBookOpen size={14} color="blue.500" />}
          label="View Scenario docs"
          description="Read documentation on using Scenario, and best practices for simulations"
          external
        />
      </VStack>
    </VStack>
  );
};

export default AgentSimulationTesting;
