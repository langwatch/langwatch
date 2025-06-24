import {
  Box,
  Heading,
  VStack,
  Circle,
  Text,
  Button,
} from "@chakra-ui/react";
import { LuBot, LuBookOpen, LuUsers, LuExternalLink } from "react-icons/lu";
import { FaDiscord } from "react-icons/fa6";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEvent } from "../../utils/tracking";
import React from "react";

interface Resource {
  icon: React.ReactNode;
  label: string;
  description: string;
  href: string;
  event: string;
  buttonText: string;
  colorScheme: string;
  bg: string;
}

const resources: Resource[] = [
  {
    icon: <LuBot size={14} color="orange" />,
    label: "Demo Account",
    description: "View our demo account to see how LangWatch works with a sample chatbot",
    href: "https://app.langwatch.ai/demo",
    event: "demo_account_click",
    buttonText: "View Demo",
    colorScheme: "orange",
    bg: "orange.100",
  },
  {
    icon: <LuBookOpen size={14} color="blue" />,
    label: "Documentation",
    description: "Comprehensive guides, API references, and best practices for LangWatch integration",
    href: "https://docs.langwatch.ai",
    event: "documentation_click",
    buttonText: "Browse LangWatch Docs",
    colorScheme: "blue",
    bg: "blue.100",
  },
  {
    icon: <FaDiscord size={14} color="#5865F2" />,
    label: "Community",
    description: "Join our community to share experiences, get help, and stay updated with the latest features",
    href: "https://discord.gg/langwatch",
    event: "community_click",
    buttonText: "Join Discord",
    colorScheme: "blue",
    bg: "purple.200",
  },
];

interface ResourceButtonProps {
  resource: Resource;
  onClick: () => void;
}

const ResourceButton: React.FC<ResourceButtonProps> = ({ resource, onClick }) => (
  <Button
    asChild
    variant="outline"
    colorScheme={resource.colorScheme}
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
    onClick={onClick}
    _hover={{ textDecoration: "none" }}
    transition="all 0.2s"
    aria-label={resource.buttonText + ' (opens in a new tab)'}
  >
    <a
      href={resource.href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "flex", alignItems: "center", width: "100%" }}
      aria-label={resource.buttonText + ' (opens in a new tab)'}
    >
      <Circle size="26px" bg={resource.bg} flexShrink={0}>
        {resource.icon}
      </Circle>
      <Box flex={1} display="flex" flexDirection="column" alignItems="flex-start" minW={0} ml={2}>
        <Text fontWeight="medium" textAlign="left">{resource.buttonText}</Text>
        <Text color="gray.500" fontSize="xs" mt={0.25} textAlign="left" maxW="100%" overflow="hidden" whiteSpace="nowrap" textOverflow="ellipsis">
          {resource.description}
        </Text>
      </Box>
      <Box as="span" color="gray.400" ml={2} display="flex" alignItems="center">
        <LuExternalLink size={18} />
      </Box>
    </a>
  </Button>
);

const ResourcesCard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  return (
    <Box minH="120px" boxShadow="sm" borderRadius="xl" bg="white" p={4}>
      <VStack align="start" gap={4} w="full">
        <VStack gap={0} alignItems="flex-start" justifyContent="flex-start">
          <Heading size="md" fontWeight="bold" textAlign="left">
            Resources
          </Heading>
          <Text fontSize="xs" color="gray.500" textAlign="left">
            Explore examples and learn from our demo implementations
          </Text>
        </VStack>
        <VStack w="full" align="stretch" gap={4}>
          {resources.map((resource) => (
            <ResourceButton
              key={resource.href}
              resource={resource}
              onClick={() => trackEvent(resource.event, { project_id: project?.id })}
            />
          ))}
        </VStack>
      </VStack>
    </Box>
  );
};

export default ResourcesCard;
