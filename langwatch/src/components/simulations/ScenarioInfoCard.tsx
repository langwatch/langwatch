import { Box, Heading, VStack, Text, HStack, Badge, Icon, Button, Link as ChakraLink, List, Separator, Spinner } from "@chakra-ui/react";
import { LuBot, LuBookOpen, LuExternalLink, LuCircleCheck } from "react-icons/lu";
import { motion } from "framer-motion";

const MotionBox = motion(Box);

const ScenarioInfoCard: React.FC = () => (
  <MotionBox
    initial={{ opacity: 0, y: 40 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
    minH="120px"
    boxShadow="sm"
    borderRadius="xl"
    p={8}
    w="full"
    maxW="680px"
    mx="auto"
    style={{
      background: `
        radial-gradient(ellipse 70% 60% at 60% 95%, rgba(180,255,236,0.42) 0%, transparent 85%),
        radial-gradient(ellipse 60% 80% at 20% 30%, rgba(255,229,180,0.48) 0%, transparent 85%),
        radial-gradient(ellipse 50% 60% at 60% 20%, rgba(224,215,255,0.52) 0%, transparent 85%),
        radial-gradient(ellipse 80% 100% at 50% 80%, rgba(255,255,255,0.85) 0%, transparent 90%)
      `
    }}
  >
    <VStack align="start" gap={3} mb={0}>
      <HStack gap={2}>
        <Badge size="md" colorPalette="orange" variant="subtle" borderRadius="2xl">
          New
        </Badge>
        <Heading size="lg" fontWeight="bold" textAlign="left">
          Scenario: Agentic Simulations
        </Heading>
      </HStack>
      <Text fontSize="md" color="gray.700" textAlign="left">
        <b>Scenario</b> is the most advanced and flexible agent testing framework. It lets you simulate users, complex flows, test edge cases, and guarantee agent quality. No dataset required.
      </Text>
    </VStack>
    <Separator my={2} />
    <VStack align="start" gap={3}>
      <Text fontWeight="semibold">What can you do with Scenario?</Text>
      <List.Root as="ul" listStyleType={"none"} pl={2} color="CaptionText">
        <List.Item><HStack gap={2}><Icon as={LuCircleCheck} color="green.400" /> <span>Simulate real user conversations and edge cases</span></HStack></List.Item>
        <List.Item><HStack gap={2}><Icon as={LuCircleCheck} color="green.400" /> <span>Test your agent end-to-end, not just in isolation</span></HStack></List.Item>
        <List.Item><HStack gap={2}><Icon as={LuCircleCheck} color="green.400" /> <span>Combine with evals for deep, multi-turn control</span></HStack></List.Item>
        <List.Item><HStack gap={2}><Icon as={LuCircleCheck} color="green.400" /> <span>Integrate with any agent framework by implementing a single <code>call()</code> method</span></HStack></List.Item>
        <List.Item><HStack gap={2}><Icon as={LuCircleCheck} color="green.400" /> <span>No dataset required, write scenarios as code</span></HStack></List.Item>
      </List.Root>
    </VStack>
    <Separator my={2} />
    <VStack align="start" gap={2}>
      <Text fontWeight="semibold">Why use Scenario?</Text>
      <List.Root as="ul" pl={7} color="CaptionText">
        <List.Item>Catch regressions <b>before users do</b></List.Item>
        <List.Item>Safely refactor prompts, tools, or agent structure</List.Item>
        <List.Item>Boost confidence in production releases</List.Item>
        <List.Item>Works with <b>Python</b>, <b>TypeScript</b>, and soon: <b>Go</b></List.Item>
      </List.Root>
    </VStack>
    <VStack align="stretch" w="full" mt={6} gap={2}>
      <ChakraLink
        href="https://scenario.langwatch.ai/"
        target="_blank"
        rel="noopener noreferrer"
        w="full"
        _hover={{ textDecoration: "none" }}
      >
        <Button
          colorPalette="orange"
          color="orange.600"
          variant="surface"
          fontWeight="normal"
          borderRadius="md"
          px={3}
          py={6}
          w="full"
          aria-label="Learn more about Scenario (opens in a new tab)"
          display="flex"
          alignItems="center"
          gap={2}
        >
          <Icon as={LuBookOpen} boxSize={4} color="orange.500" />
          <Box as="span" flex={1} textAlign="left">
            Read the Scenario docs, and get started!
          </Box>
          <Icon as={LuExternalLink} boxSize={4} color="gray.400" />
        </Button>
      </ChakraLink>
    </VStack>
    <VStack align="center" w="full" mt={5} mb={0} gap={4}>
      <Text fontSize="lg" color="gray.700" fontWeight="semibold" textAlign="center">
        Your simulations will appear here once you start running Scenario
      </Text>
      <Spinner borderWidth="3px" animationDuration="0.8s" opacity={0.6} />
    </VStack>
  </MotionBox>
);

export default ScenarioInfoCard; 
