import { Box, Grid, GridItem, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  FlaskConical,
  type LucideIcon,
  MessageSquareText,
  Settings,
  Shield,
} from "lucide-react";
import { Link } from "~/components/ui/link";
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
      borderColor={{ base: "orange.200", _dark: "orange.800" }}
      bg="bg.panel/70"
      backdropFilter="blur(20px) saturate(1.3)"
      boxShadow="0 1px 3px rgba(0,0,0,0.04)"
      transition="all 0.2s ease"
      cursor="pointer"
      _hover={{
        borderColor: "orange.emphasized",
        boxShadow:
          "0 6px 28px rgba(237,137,38,0.06)",
        transform: "translateY(-2px)",
        textDecoration: "none",
      }}
    >
    <Link href={href} textDecoration="none" color="inherit">
      <Box
        flexShrink={0}
        p={2.5}
        borderRadius="xl"
        bg="orange.50"
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
    </Link>
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
              color: "#e5e7eb",
              textDecoration: "none",
            }}
          >
            Read the docs
            <ArrowUpRight size={14} />
          </a>
        </HStack>
      </VStack>

    </>
  );
}
