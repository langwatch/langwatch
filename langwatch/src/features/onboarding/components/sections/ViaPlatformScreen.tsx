import { Box, Button, Grid, GridItem, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  BookOpen,
  FlaskConical,
  type LucideIcon,
  MessageSquareText,
  Settings,
  Shield,
} from "lucide-react";
import { useRouter } from "next/router";
import type React from "react";
import { ArrowRight } from "react-feather";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

interface CapabilityProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

const capabilities: CapabilityProps[] = [
  {
    icon: Activity,
    title: "Traces & Analytics",
    description: "Monitor LLM calls, latency, costs, and user interactions",
  },
  {
    icon: Shield,
    title: "Evaluations",
    description: "Set up automated quality checks on your LLM outputs",
  },
  {
    icon: MessageSquareText,
    title: "Prompts",
    description: "Version, test, and manage your prompts from the dashboard",
  },
  {
    icon: FlaskConical,
    title: "Scenarios",
    description: "Create test scenarios to validate agent behavior",
  },
  {
    icon: BookOpen,
    title: "Datasets",
    description: "Build and curate datasets for evaluation and fine-tuning",
  },
  {
    icon: Settings,
    title: "Model Providers",
    description: "Configure API keys for the models you use",
  },
];

function CapabilityCard({
  icon: Icon,
  title,
  description,
}: CapabilityProps): React.ReactElement {
  return (
    <HStack
      align="start"
      gap={3}
      p={4}
      flex={1}
      borderRadius="xl"
      border="1px solid"
      borderColor="gray.200"
      bg="white/70"
      backdropFilter="blur(20px) saturate(1.3)"
      boxShadow="0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 white"
      transition="all 0.2s ease"
      _hover={{
        borderColor: "gray.300",
        boxShadow:
          "0 6px 28px rgba(0,0,0,0.07), inset 0 1px 0 white",
        transform: "translateY(-1px)",
      }}
    >
      <Box
        flexShrink={0}
        p={2}
        borderRadius="lg"
        bg="rgba(237,137,38,0.10)"
        color="orange.500"
        display="flex"
        alignItems="center"
        justifyContent="center"
        border="1px solid"
        borderColor="rgba(237,137,38,0.15)"
      >
        <Icon size={16} strokeWidth={1.75} />
      </Box>
      <VStack align="stretch" gap={0.5}>
        <Text
          fontSize="sm"
          fontWeight="semibold"
          color="fg.DEFAULT"
          letterSpacing="-0.01em"
        >
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          {description}
        </Text>
      </VStack>
    </HStack>
  );
}

export function ViaPlatformScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();

  return (
    <>
      <VStack align="stretch" gap={6} mb={20} maxW="720px" mx="auto">
        <Text fontSize="sm" color="fg.muted" lineHeight="tall">
          Configure everything directly from the LangWatch dashboard — no code
          changes required to get started.
        </Text>

        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
          gap={3}
        >
          {capabilities.map((cap) => (
            <GridItem key={cap.title} display="flex">
              <CapabilityCard {...cap} />
            </GridItem>
          ))}
        </Grid>

        <Box pt={2} display="flex" justifyContent="center">
          {project?.slug && (
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              colorPalette="orange"
              borderRadius="xl"
              px={8}
              py={2}
              size="lg"
              boxShadow="0 4px 24px rgba(237,137,38,0.20)"
              _hover={{
                transform: "translateY(-1px)",
                boxShadow: "0 6px 32px rgba(237,137,38,0.28)",
              }}
              transition="all 0.2s ease"
            >
              <HStack gap={2}>
                <Text>Enter the Platform</Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          )}
        </Box>
      </VStack>

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Tooltip
            content="Continue to LangWatch — skip onboarding"
            positioning={{ placement: "left" }}
            showArrow
            openDelay={0}
          >
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              aria-label="Continue to LangWatch"
              borderRadius="full"
              variant="ghost"
              colorPalette="gray"
              bg="white/50"
              backdropFilter="blur(20px) saturate(1.3)"
              _hover={{
                bg: "white/70",
                transform: "translateY(-1px)",
              }}
              borderWidth="1px"
              borderColor="gray.200"
              boxShadow="0 4px 24px rgba(0,0,0,0.06), inset 0 1px 0 white"
              px={{ base: 2, md: 4 }}
              py={2}
            >
              <HStack gap={{ base: 0, md: 2 }}>
                <Text display={{ base: "none", md: "inline" }}>
                  Continue to LangWatch
                </Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
