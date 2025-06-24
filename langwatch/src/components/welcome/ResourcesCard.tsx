import {
  Box,
  Heading,
  VStack,
  Circle,
  Text,
  Button,
} from "@chakra-ui/react";
import { LuBot, LuBookOpen, LuUsers, LuExternalLink } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEvent } from "../../utils/tracking";

const resources = [
  {
    icon: <LuBot size={14} color="#fb923c" />,
    label: "Demo Account",
    description:
      "View our demo account to see how LangWatch works with a sample chatbot.",
    href: "https://app.langwatch.ai/demo",
    event: "demo_account_click",
    buttonText: "View Demo",
    buttonColor: "orange.400",
    buttonBg: "orange.400",
    buttonHover: "orange.500",
  },
  {
    icon: <LuBookOpen size={14} color="#2563eb" />,
    label: "Documentation",
    description:
      "Comprehensive guides, API references, and best practices for LangWatch integration.",
    href: "https://docs.langwatch.ai",
    event: "documentation_click",
    buttonText: "Browse Docs",
    buttonColor: "blue.500",
    buttonBg: "blue.500",
    buttonHover: "blue.600",
  },
  {
    icon: <LuUsers size={14} color="#22c55e" />,
    label: "Community",
    description:
      "Join our community to share experiences, get help, and stay updated with the latest features.",
    href: "https://discord.gg/langwatch",
    event: "community_click",
    buttonText: "Join Discord",
    buttonColor: "green.400",
    buttonBg: "green.400",
    buttonHover: "green.500",
  },
];

const ResourcesCard = () => {
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
            <Button
              asChild
              key={resource.label}
              variant={"outline"}
              colorScheme={
                resource.label === "Demo Account"
                  ? "orange"
                  : resource.label === "Documentation"
                  ? "blue"
                  : "green"
              }
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
              onClick={() =>
                trackEvent(resource.event, {
                  project_id: project?.id,
                })
              }
              _hover={{
                textDecoration: "none",
              }}
              transition="all 0.2s"
            >
              <a
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", width: "100%" }}
              >
                <Circle
                  size="26px"
                  bg={
                    resource.label === "Demo Account"
                      ? "orange.100"
                      : resource.label === "Documentation"
                      ? "blue.100"
                      : "green.100"
                  }
                  flexShrink={0}
                >
                  {resource.icon}
                </Circle>
                <Box
                  flex={1}
                  display="flex"
                  flexDirection="column"
                  alignItems="flex-start"
                  minW={0}
                  ml={2}
                >
                  <Text fontWeight="medium" textAlign="left">
                    {resource.buttonText}
                  </Text>
                  <Text
                    color="gray.500"
                    fontSize="xs"
                    mt={0.25}
                    textAlign="left"
                    maxW={"100%"}
                    overflow="hidden"
                    whiteSpace="nowrap"
                    textOverflow="ellipsis"
                  >
                    {resource.description}
                  </Text>
                </Box>
                <Box as="span" color="gray.400" ml={2} display="flex" alignItems="center">
                  <LuExternalLink size={18} />
                </Box>
              </a>
            </Button>
          ))}
        </VStack>
      </VStack>
    </Box>
  );
};

export default ResourcesCard;
