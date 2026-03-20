import { Box, Grid, GridItem, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  BookOpen,
  FlaskConical,
  type LucideIcon,
  MessageSquareText,
  Settings,
  Shield,
} from "lucide-react";
import type React from "react";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

interface CapabilityProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** URL path. If starts with "/" it's appended to project slug, otherwise used as-is. */
  path: string;
  /** If true, path is absolute and not prefixed with project slug. */
  absolute?: boolean;
}

const capabilities: CapabilityProps[] = [
  {
    icon: Activity,
    title: "Traces & Analytics",
    description: "Monitor LLM calls, latency, costs, and user interactions",
    path: "/messages",
  },
  {
    icon: Shield,
    title: "Evaluations",
    description: "Set up automated quality checks on your LLM outputs",
    path: "/evaluations",
  },
  {
    icon: MessageSquareText,
    title: "Prompts",
    description: "Version, test, and manage your prompts from the dashboard",
    path: "/prompts",
  },
  {
    icon: FlaskConical,
    title: "Scenarios",
    description: "Create test scenarios to validate agent behavior",
    path: "/simulations",
  },
  {
    icon: BookOpen,
    title: "Datasets",
    description: "Build and curate datasets for evaluation and fine-tuning",
    path: "/datasets",
  },
  {
    icon: Settings,
    title: "Model Providers",
    description: "Configure API keys for the models you use",
    path: "/settings/model-providers",
    absolute: true,
  },
];

function CapabilityCard({
  icon: Icon,
  title,
  description,
  href,
}: CapabilityProps & { href: string }): React.ReactElement {
  return (
    <VStack
      asChild
      align="start"
      gap={3}
      p={5}
      flex={1}
      borderRadius="xl"
      border="1px solid"
      borderColor="gray.200"
      bg="white/70"
      backdropFilter="blur(20px) saturate(1.3)"
      boxShadow="0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 white"
      transition="all 0.2s ease"
      cursor="pointer"
      _hover={{
        borderColor: "rgba(237,137,38,0.25)",
        boxShadow:
          "0 6px 28px rgba(237,137,38,0.06), inset 0 1px 0 white",
        transform: "translateY(-2px)",
        textDecoration: "none",
      }}
    >
    <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <Box
        flexShrink={0}
        p={2.5}
        borderRadius="xl"
        bg="rgba(237,137,38,0.08)"
        color="orange.500"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Icon size={20} strokeWidth={1.5} />
      </Box>
      <VStack align="stretch" gap={1}>
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
    </a>
    </VStack>
  );
}

export function ViaPlatformScreen(): React.ReactElement {
  const { project } = useActiveProject();

  return (
    <>
      <VStack align="stretch" gap={6} mb={20} w="full">
        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }}
          gap={3}
        >
          {capabilities.map((cap) => (
            <GridItem key={cap.title} display="flex">
              <CapabilityCard
                {...cap}
                href={
                  cap.absolute
                    ? cap.path
                    : project?.slug
                      ? `/${project.slug}${cap.path}`
                      : "#"
                }
              />
            </GridItem>
          ))}
        </Grid>

        <HStack justify="center" pt={2}>
          <a
            href="https://docs.langwatch.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              color: "#51676C",
              textDecoration: "none",
            }}
          >
            Read the docs
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
          </a>
        </HStack>
      </VStack>

    </>
  );
}
