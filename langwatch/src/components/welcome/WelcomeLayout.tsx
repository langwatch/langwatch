import {
  Alert,
  Box,
  Container,
  Grid,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuExternalLink } from "react-icons/lu";
import { useColorModeValue } from "../ui/color-mode";
import { Link } from "../ui/link";
import AgentSimulationTesting from "./AgentSimulationTesting";
import APICard from "./APICard";
import IntegrationChecksCard from "./IntegrationChecksCard";
import ObservabilityCard from "./ObservabilityCard";
import ResourcesCard from "./ResourcesCard";

const WelcomeLayout = () => {
  return (
    <Box minH="100vh" py={6} px={2} w="full">
      <Container maxW="container.lg" w="full" mx="auto">
        <VStack gap={{ base: 4, md: 8 }} align="start">
          <Box>
            <Heading>
              Get started with LangWatch
            </Heading>
            <Text color="gray.500" fontSize="sm">
              Set up your project and start monitoring your AI applications
            </Text>
          </Box>

          <Grid
            templateColumns={{
              base: "1fr",
              lg: "minmax(0, 0.8fr) minmax(0, 1fr)",
            }}
            gap={{ base: 4, md: 8 }}
            w="full"
          >
            {/* Left column (desktop) */}
            <Box
              display="flex"
              flexDirection="column"
              gap={{ base: 4, md: 8 }}
              order={{ base: 2, md: 2, lg: 1 }}
              w="full"
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
              w="full"
            >
              <APICard />
              <Box display={{ base: "block", md: "none", lg: "block" }}>
                <AgentSimulationTesting />
              </Box>
            </Box>
          </Grid>
          <Alert.Root status="info" borderRadius="md">
            <Alert.Indicator />
            <Alert.Title>
              Having issues getting started? Traces not visible yet? Check out
              our
              <Link
                href="https://docs.langwatch.ai/support"
                isExternal
                ml={1}
                textDecoration="underline"
                textDecorationStyle={"dashed"}
              >
                Troubleshooting & Support guide
                <LuExternalLink />
              </Link>
            </Alert.Title>
          </Alert.Root>
        </VStack>
      </Container>
    </Box>
  );
};

export default WelcomeLayout;
