import {
  Box,
  Heading,
  VStack,
  HStack,
  Circle,
  Text,
  Link as ChakraLink,
} from "@chakra-ui/react";
import { FaGolang, FaJs, FaPython } from "react-icons/fa6";
import { MdHttp } from "react-icons/md";
import { LuExternalLink } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEvent } from "../../utils/tracking";

const guides = [
  {
    icon: <FaPython size={16} color="#3776AB" />,
    label: "Python Guide",
    href: "https://docs.langwatch.ai/integration/python/guide",
    event: "integration_guide_click",
    language: "python",
  },
  {
    icon: <FaJs size={16} color="#F0DB4F" />,
    label: "TypeScript Guide",
    href: "https://docs.langwatch.ai/integration/typescript/guide",
    event: "integration_guide_click",
    language: "typescript",
  },
  {
    icon: <FaGolang size={16} color="#00ADD8" />,
    label: "Golang SDK",
    href: "https://github.com/langwatch/langwatch/tree/main/sdk-go",
    event: "integration_guide_click",
    language: "golang",
  },
  {
    icon: <MdHttp size={16} color="#64748b" />,
    label: "REST API Guide",
    href: "https://docs.langwatch.ai/integration/rest-api",
    event: "integration_guide_click",
    language: "rest",
  },
];

const ObservabilityCard = () => {
  const { project } = useOrganizationTeamProject();
  return (
    <Box minH="120px" boxShadow="sm" borderRadius="xl" bg="white" p={4}>
      <HStack
        mb={3}
        gap={2}
        alignItems="flex-start"
        justifyContent="flex-start"
      >
        <Heading size="md" fontWeight="bold" textAlign="left">
          Observability setup
        </Heading>
      </HStack>
      <VStack gap={2} fontSize="sm" align="stretch">
        {guides.map((guide) => (
          <ChakraLink
            as="a"
            href={guide.href}
            target="_blank"
            rel="noopener noreferrer"
            key={guide.label}
            display="flex"
            alignItems="center"
            gap={3}
            px={3}
            py={2}
            borderRadius="md"
            borderWidth={1}
            borderColor="gray.200"
            _hover={{
              textDecoration: "none",
              bg: "gray.50",
              borderColor: "gray.300",
            }}
            transition="all 0.2s"
            onClick={() =>
              trackEvent(guide.event, {
                language: guide.language,
                project_id: project?.id,
              })
            }
          >
            <Circle
              size="24px"
              bg={
                guide.language === "python"
                  ? "blue.50"
                  : guide.language === "typescript"
                  ? "cyan.50"
                  : "gray.100"
              }
            >
              {guide.icon}
            </Circle>
            <Text fontWeight="medium" flex={1} textAlign="left">
              {guide.label}
            </Text>
            <Box as="span" color="gray.400" ml={1} display="flex" alignItems="center">
              <LuExternalLink size={16} />
            </Box>
          </ChakraLink>
        ))}
      </VStack>
    </Box>
  );
};

export default ObservabilityCard;
