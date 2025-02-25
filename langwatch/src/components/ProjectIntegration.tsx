import { techStackLanguageOptions } from "./TechStack";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spinner,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { APIKeyCopyInput } from "../pages/authorize";
import { IconWrapper } from "./IconWrapper";
import { IntegrationChecks } from "./IntegrationChecks";
import { trackEvent } from "../utils/tracking";
import { ExternalLink } from "react-feather";
import { Link } from "./ui/link";

export const ProjectIntegration = () => {
  const { project, isRefetching } = useOrganizationTeamProject({
    keepFetching: true,
  });

  return (
    <DashboardLayout backgroundColor="gray.100" maxWidth="100%">
      <HStack gap={0} width="full" height="full" align="start">
        <VStack
          align="start"
          background="white"
          padding={6}
          borderRightWidth="1px"
          borderColor="gray.300"
          minWidth="280px"
          height="full"
          gap={6}
          display={["none", "none", "none", "flex"]}
        >
          <Heading as="h2" size="md">
            Integration checks
          </Heading>
          <IntegrationChecks />
        </VStack>
        <VStack align="flex-start" gap={6} width="full" padding={6}>
          <HStack width={"full"}>
            <Heading as="h2" size="md">
              Integration guides
            </Heading>
            <Spacer />
            {isRefetching && <Spinner />}
          </HStack>
          <Text>
            Follow the instructions on our docs to setup your project with
            LangWatch, this page will update automatically as soon as the first
            messages arrive.
          </Text>

          {typeof window !== "undefined" &&
            window.location.hostname !== "app.langwatch.ai" && (
              <Text>
                Use{" "}
                <code>
                  {`LANGWATCH_ENDPOINT="${window.location.protocol}//${window.location.host}"`}
                </code>{" "}
                when setting it up to point to this instance
              </Text>
            )}
          <VStack width="full" align="stretch" gap={6}>
            <Card.Root width="full">
              <Card.Header paddingBottom={0}>
                <Heading as="h2" size="md">
                  API Key
                </Heading>
              </Card.Header>
              <Card.Body>
                <VStack gap={6} align="start">
                  <Text>
                    Copy your LangWatch API key to use for the integration
                  </Text>
                  <Box width="full" maxWidth="560px">
                    <APIKeyCopyInput />
                  </Box>
                </VStack>
              </Card.Body>
            </Card.Root>
            <HStack width="full" gap={8} align="stretch" justify="stretch">
              <Card.Root width="full">
                <Card.Header>
                  <Heading as="h2" size="md">
                    Integration Guides
                  </Heading>
                </Card.Header>
                <Card.Body>
                  <VStack align="start" gap={8}>
                    <Link
                      href="https://docs.langwatch.ai/integration/python/guide"
                      isExternal
                      onClick={() =>
                        trackEvent("integration_guide_click", {
                          language: "python",
                          project_id: project?.id,
                        })
                      }
                    >
                      <HStack align="center" gap={2}>
                        <IconWrapper width="24px" height="24px">
                          {techStackLanguageOptions.python.icon}
                        </IconWrapper>
                        <Text>
                          {techStackLanguageOptions.python.label} Integration
                          Guide
                        </Text>
                        <ExternalLink />
                      </HStack>
                    </Link>
                    <Link
                      href="https://docs.langwatch.ai/integration/typescript/guide"
                      isExternal
                      onClick={() =>
                        trackEvent("integration_guide_click", {
                          language: "typescript",
                          project_id: project?.id,
                        })
                      }
                    >
                      <HStack align="center" gap={2}>
                        <IconWrapper width="24px" height="24px">
                          {techStackLanguageOptions.typescript.icon}
                        </IconWrapper>
                        <Text>
                          {techStackLanguageOptions.typescript.label}{" "}
                          Integration Guide
                        </Text>
                        <ExternalLink />
                      </HStack>
                    </Link>
                    <Link
                      href="https://docs.langwatch.ai/integration/rest-api"
                      isExternal
                      onClick={() =>
                        trackEvent("integration_guide_click", {
                          language: "rest",
                          project_id: project?.id,
                        })
                      }
                    >
                      <HStack align="center" gap={2}>
                        <IconWrapper width="24px" height="24px">
                          {techStackLanguageOptions.other.icon}
                        </IconWrapper>
                        <Text>Custom REST Integration Guide</Text>
                        <ExternalLink />
                      </HStack>
                    </Link>
                  </VStack>
                </Card.Body>
              </Card.Root>
              <Card.Root width="full" minHeight="100%">
                <Card.Header>
                  <Heading as="h2" size="md">
                    Demo Account
                  </Heading>
                </Card.Header>
                <Card.Body>
                  <VStack gap={6} align="start" height="full">
                    <Text>
                      View our demo account to see how LangWatch works with a
                      sample chatbot.
                    </Text>
                    <Spacer />
                    <Link
                      href={`https://app.langwatch.ai/demo`}
                      onClick={() =>
                        trackEvent("demo_account_click", {
                          project_id: project?.id,
                        })
                      }
                      isExternal
                    >
                      <Button colorPalette="orange" size="lg">
                        View Demo
                      </Button>
                    </Link>
                  </VStack>
                </Card.Body>
              </Card.Root>
            </HStack>
          </VStack>
          <Text fontSize="14px">
            Having issues? Messages not visible yet? Check out our{" "}
            <Link
              textDecoration="underline"
              href="https://docs.langwatch.ai/support"
              isExternal
            >
              Troubleshooting & Support
            </Link>{" "}
            guide
          </Text>
        </VStack>
      </HStack>
    </DashboardLayout>
  );
};
