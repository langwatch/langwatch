import { Box, Container, Grid, Heading, VStack, Text } from "@chakra-ui/react";
import IntegrationChecksCard from "./IntegrationChecksCard";
import APICard from "./APICard";
import ObservabilityCard from "./ObservabilityCard";
import ResourcesCard from "./ResourcesCard";
import { useColorModeValue } from "../ui/color-mode";
import AITestingSimulationCard from "./AITestingSimulationCard";

const WelcomeLayout = () => {
  const bg = useColorModeValue("gray.50", "gray.900");

  return (
    <Box
      minH="100vh"
      bg={bg}
      py={{ base: 6, md: 12 }}
      px={2}
      w="full"
    >
      <Container maxW="container.lg" w="full" mx="auto">
        <VStack gap={{ base: 4, md: 8 }} align="start">
          <Box>
            <Heading size={{ base: "md", md: "lg" }} fontWeight="extrabold">Get started with LangWatch</Heading>
            <Text color="gray.500" fontSize={{ base: "sm", md: "md" }}>Set up your project and start monitoring your AI applications</Text>
          </Box>

          <Grid
            templateColumns={{ base: "1fr", lg: "minmax(0, 0.8fr) minmax(0, 1fr)" }}
            gap={{ base: 4, md: 8 }}
          >
            {/* Left column (desktop) */}
            <Box
              display="flex"
              flexDirection="column"
              gap={{ base: 4, md: 8 }}
              order={{ base: 2, md: 2, lg: 1 }}
              w="100%"
            >
              <IntegrationChecksCard />
              <ObservabilityCard />
              <ResourcesCard />
            </Box>

            {/* Right column (desktop) */}
            <Box
              display="flex"
              flexDirection="column"
              gap={{ base: 4, md: 8 }}
              order={{ base: 2, md: 1, lg: 2 }}
              w="100%"
            >
              <APICard />
              <Box mb={2} display={{ base: 'block', md: 'none', lg: 'block' }}>
                <Heading size={{ base: "md", md: "lg" }} fontWeight="extrabold">
                  Introducing Scenario
                </Heading>
                <Text color="gray.500" fontSize={{ base: "sm", md: "md" }}>
                  A new way to test and optimize your AI agents
                </Text>
                <Box mb={4} display={{ base: 'none', md: 'none', lg: 'block' }}></Box>
                <AITestingSimulationCard />
              </Box>
            </Box>
          </Grid>
        </VStack>
      </Container>
    </Box>
  );
};

export default WelcomeLayout; 
