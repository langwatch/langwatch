import {
  Box,
  Grid,
  Heading,
  HStack,
  Link as ChakraLink,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuBookOpen, LuExternalLink, LuPlay } from "react-icons/lu";
import { Link } from "../ui/link";

type ResourceCard = {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  background: string;
  href: string;
  cta: string;
};

const resources: ResourceCard[] = [
  {
    title: "Documentation",
    description: "Learn how to integrate and use LangWatch effectively",
    icon: <LuBookOpen size={18} />,
    color: "blue",
    background: "blue.50",
    href: "https://docs.langwatch.ai",
    cta: "View documentation",
  },
  {
    title: "Video Tutorials",
    description: "Watch step-by-step guides and feature walkthroughs",
    icon: <LuPlay size={18} />,
    color: "red",
    background: "red.50",
    href: "https://www.youtube.com/@LangWatch/videos",
    cta: "Watch videos",
  },
];

type ResourceCardItemProps = {
  resource: ResourceCard;
};

/**
 * Single resource card
 */
function ResourceCardItem({ resource }: ResourceCardItemProps) {
  return (
    <ChakraLink
      href={resource.href}
      target="_blank"
      rel="noopener noreferrer"
      _hover={{ textDecoration: "none" }}
      height="full"
      width="full"
    >
      <VStack
        align="start"
        padding={4}
        gap={3}
        borderRadius="xl"
        background={resource.background}
        transition="all 0.2s ease-in-out"
        _hover={{
          opacity: 0.85,
        }}
        height="full"
        width="full"
      >
        <HStack gap={3} align="start">
          <Box padding={2} borderRadius="lg" color={`${resource.color}.500`}>
            {resource.icon}
          </Box>
          <VStack align="start" gap={1} flex={1}>
            <Text fontWeight="medium" fontSize="sm">
              {resource.title}
            </Text>
            <Text fontSize="xs" color="gray.600">
              {resource.description}
            </Text>
            <HStack color={`${resource.color}.600`} fontSize="xs">
              <Text>{resource.cta}</Text>
              <LuExternalLink size={12} />
            </HStack>
          </VStack>
        </HStack>
      </VStack>
    </ChakraLink>
  );
}

/**
 * LearningResources
 * Section with links to documentation and video tutorials.
 */
export function LearningResources() {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading>Learning resources</Heading>
      <Grid
        templateColumns={{
          base: "1fr",
          md: "repeat(2, 1fr)",
        }}
        gap={3}
        width="full"
      >
        {resources.map((resource) => (
          <ResourceCardItem key={resource.title} resource={resource} />
        ))}
      </Grid>
      <Text fontSize="13px" color="gray.500" paddingTop={2}>
        Considering LangWatch for your team?{" "}
        <Link
          href="https://langwatch.ai/get-a-demo"
          isExternal
          color="gray.600"
          textDecoration="underline"
          _hover={{ color: "orange.500" }}
        >
          Request a demo
        </Link>
      </Text>
    </VStack>
  );
}
