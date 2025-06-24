import { Box, Heading, VStack, Text, HStack, Badge, Icon, Button, Circle, Link as ChakraLink } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { LuBot, LuBookOpen, LuExternalLink, LuBotMessageSquare } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

const AITestingSimulationCard = () => {
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? "";
  return (
    <VStack
      minH="80px"
      minW={{ base: 0, md: "320px", lg: "400px" }}
      w="100%"
      boxShadow="sm"
      borderRadius="xl"
      bg="white"
      p={4}
      gap={2}
      align="stretch"
    >
      <VStack mb={1} align="start">
        <HStack gap={2}>
          <Icon color="orange.500" size={"sm"}><LuBot /></Icon>
          <Heading size="md" fontWeight="bold" textAlign="left">
            Agent Simulations
          </Heading>
          <Badge size="md" colorPalette={"orange"} variant={"subtle"} borderRadius={"2xl"}>
            New
          </Badge>
        </HStack>
        <Text fontSize="xs" color="gray.500" textAlign="left">
          Test your AI agents with realistic scenarios and conversations. Create simulated
          interactions to evaluate performance before deployment.
        </Text>
      </VStack>
      <VStack w="full" align="stretch" gap={4} mt={2}>
        <Button
          asChild
          variant="surface"
          colorPalette="orange"
          colorScheme={"orange"}
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
        >
          <a
            href={`/${projectSlug}/simulations`}
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <Circle size="26px" bg="orange.100" flexShrink={0}>
              <LuBotMessageSquare size={14} color="orange.500" />
            </Circle>
            <Box flex={1} display="flex" flexDirection="column" alignItems="flex-start" minW={0} ml={2}>
              <Text fontWeight="medium" textAlign="left">View your simulations</Text>
              <Text color="gray.500" fontSize="xs" mt={0.25} textAlign="left" maxW={"100%"} overflow="hidden" whiteSpace="nowrap" textOverflow="ellipsis">
                Explore, manage, and review your agent simulation sets
              </Text>
            </Box>
            <Box as="span" color="gray.400" ml={2} display="flex" alignItems="center">
              <LuExternalLink size={18} />
            </Box>
          </a>
        </Button>
        <Button
          asChild
          variant="surface"
          colorPalette="blue"
          colorScheme={"blue"}
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
        >
          <a
            href="https://scenario.langwatch.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <Circle size="26px" bg="blue.100" flexShrink={0}>
              <LuBookOpen size={14} color="blue.500" />
            </Circle>
            <Box flex={1} display="flex" flexDirection="column" alignItems="flex-start" minW={0} ml={2}>
              <Text fontWeight="medium" textAlign="left">View Scenario docs</Text>
              <Text color="gray.500" fontSize="xs" mt={0.25} textAlign="left" maxW={"100%"} overflow="hidden" whiteSpace="nowrap" textOverflow="ellipsis">
                Read documentation on using Scenario, and best practices for simulations
              </Text>
            </Box>
            <Box as="span" color="gray.400" ml={2} display="flex" alignItems="center">
              <LuExternalLink size={18} />
            </Box>
          </a>
        </Button>
      </VStack>
    </VStack>
  );
};

export default AITestingSimulationCard;
