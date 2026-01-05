import {
  Box,
  Container,
  VStack,
} from "@chakra-ui/react";
import APICard from "./APICard";

/**
 * WelcomeLayout
 * Simplified setup page focused on API key and SDK setup.
 * Integration checks, resources, and agent simulations are now on the home page.
 */
const WelcomeLayout = () => {
  return (
    <Box minH="100vh" py={6} px={2} w="full">
      <Container maxW="container.md" w="full" mx="auto">
        <VStack gap={{ base: 4, md: 6 }} align="start">
          <VStack gap={6} w="full" pt={16}>
            <APICard />
          </VStack>
        </VStack>
      </Container>
    </Box>
  );
};

export default WelcomeLayout;
