import {
  Box,
  Heading,
  VStack,
  HStack,
  Text,
  Link as ChakraLink,
} from "@chakra-ui/react";
import { FaGolang, FaJs, FaPython } from "react-icons/fa6";
import { MdHttp } from "react-icons/md";
import { LuExternalLink } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEvent } from "../../utils/tracking";
import React from "react";

interface Guide {
  icon: React.ReactNode;
  label: string;
  href: string;
  event: string;
  language: string;
  bg: string;
}

const guides: Guide[] = [
  {
    icon: <FaPython size={16} color="#4584b6" />,
    label: "Get started using our Python SDK",
    href: "https://docs.langwatch.ai/integration/python/guide",
    event: "integration_guide_click",
    language: "python",
    bg: "blue.50",
  },
  {
    icon: <FaJs size={16} color="#2563eb" />,
    label: "Follow the TypeScript guide",
    href: "https://docs.langwatch.ai/integration/typescript/guide",
    event: "integration_guide_click",
    language: "typescript",
    bg: "cyan.50",
  },
  {
    icon: <FaGolang size={16} color="#00ADD8" />,
    label: "Get going with our Golang SDK",
    href: "https://github.com/langwatch/langwatch/tree/main/sdk-go",
    event: "integration_guide_click",
    language: "golang",
    bg: "gray.100",
  },
  {
    icon: <MdHttp size={16} color="grey.500" />,
    label: "Integrate directly with the LangWatch API",
    href: "https://docs.langwatch.ai/integration/rest-api",
    event: "integration_guide_click",
    language: "rest",
    bg: "gray.100",
  },
];

interface GuideLinkProps {
  guide: Guide;
  onClick: () => void;
}

const GuideLink: React.FC<GuideLinkProps> = ({ guide, onClick }) => (
  <ChakraLink
    as="a"
    href={guide.href}
    target="_blank"
    rel="noopener noreferrer"
    display="flex"
    alignItems="center"
    gap={3}
    px={3}
    py={2}
    borderRadius="md"
    borderWidth={1}
    borderColor="gray.200"
    _hover={{ textDecoration: "none", bg: "gray.50", borderColor: "gray.300" }}
    transition="all 0.2s"
    onClick={onClick}
    aria-label={guide.label + ' (opens in a new tab)'}
  >
    {guide.icon}
    <Text fontWeight="medium" flex={1} textAlign="left">{guide.label}</Text>
    <Box as="span" color="gray.400" ml={1} display="flex" alignItems="center">
      <LuExternalLink size={16} />
    </Box>
  </ChakraLink>
);

const ObservabilityCard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  return (
    <Box minH="120px" boxShadow="sm" borderRadius="xl" bg="white" p={4}>
      <HStack mb={3} gap={2} alignItems="flex-start" justifyContent="flex-start">
        <Heading size="md" fontWeight="bold" textAlign="left">
          Observability setup
        </Heading>
      </HStack>
      <VStack gap={2} fontSize="sm" align="stretch">
        {guides.map((guide) => (
          <GuideLink
            key={guide.href}
            guide={guide}
            onClick={() => trackEvent(guide.event, { language: guide.language, project_id: project?.id })}
          />
        ))}
      </VStack>
    </Box>
  );
};

export default ObservabilityCard;
