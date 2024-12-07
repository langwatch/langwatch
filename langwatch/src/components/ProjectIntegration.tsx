import {
  techStackLanguageOptions,
  techStackFrameworkOptions,
  docsLinks,
} from "./TechStack";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import {
  Heading,
  VStack,
  Text,
  HStack,
  Spacer,
  Spinner,
  Link,
  Card,
  CardHeader,
  CardBody,
  List,
  ListItem,
  ListIcon,
  OrderedList,
  UnorderedList,
  Button,
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import { APIKeyCopyInput } from "../pages/authorize";
import { api } from "../utils/api";
import { IconWrapper } from "./IconWrapper";
import { IntegrationChecks } from "./IntegrationChecks";
import { trackEvent } from "../utils/tracking";

export const ProjectIntegration = () => {
  const publicEnv = api.publicEnv.useQuery(
    {},
    {
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );
  const { project, isRefetching } = useOrganizationTeamProject({
    keepFetching: true,
  });

  const languageKey = project?.language as
    | keyof typeof techStackLanguageOptions
    | undefined;
  const language = languageKey && techStackLanguageOptions[languageKey];

  const frameworkKey = project?.framework as
    | keyof typeof techStackFrameworkOptions
    | undefined;
  const framework = frameworkKey && techStackFrameworkOptions[frameworkKey];

  const integrationDocs =
    (languageKey && framework?.languages[languageKey]) ?? docsLinks.custom_rest;

  return (
    <DashboardLayout backgroundColor="gray.100" maxWidth="100%">
      <HStack spacing={0} width="full" height="full" align="start">
        <VStack
          align="start"
          background="white"
          padding={6}
          borderRightWidth="1px"
          borderColor="gray.300"
          minWidth="280px"
          height="full"
          spacing={6}
          display={["none", "none", "none", "flex"]}
        >
          <Heading as="h2" size="md">
            Integration checks
          </Heading>
          <IntegrationChecks />
        </VStack>
        <VStack align="flex-start" spacing={6} width="full" padding={6}>
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
          <VStack width="full" align="stretch" spacing={6}>
            <Card width="full">
              <CardHeader paddingBottom={0}>
                <Heading as="h2" size="md">
                  API Key
                </Heading>
              </CardHeader>
              <CardBody>
                <VStack spacing={6} align="start">
                  <Text>
                    Copy your LangWatch API key to use for the integration
                  </Text>
                  <APIKeyCopyInput />
                </VStack>
              </CardBody>
            </Card>
            <HStack width="full" spacing={8} align="stretch" justify="stretch">
              <Card width="full">
                <CardHeader>
                  <Heading as="h2" size="md">
                    Integration Guides
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack align="start" spacing={8}>
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
                      <HStack align="center" fontSize={18} spacing={2}>
                        <IconWrapper width="36px" height="36px">
                          {techStackLanguageOptions.python.icon}
                        </IconWrapper>
                        <Text>
                          {techStackLanguageOptions.python.label} Integration
                          Guide
                        </Text>
                        <ExternalLinkIcon />
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
                      <HStack align="center" fontSize={18} spacing={2}>
                        <IconWrapper width="36px" height="36px">
                          {techStackLanguageOptions.typescript.icon}
                        </IconWrapper>
                        <Text>
                          {techStackLanguageOptions.typescript.label}{" "}
                          Integration Guide
                        </Text>
                        <ExternalLinkIcon />
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
                      <HStack align="center" fontSize={18} spacing={2}>
                        <IconWrapper width="36px" height="36px">
                          {techStackLanguageOptions.other.icon}
                        </IconWrapper>
                        <Text>Custom REST Integration Guide</Text>
                        <ExternalLinkIcon />
                      </HStack>
                    </Link>
                  </VStack>
                </CardBody>
              </Card>
              <Card width="full" minHeight="100%">
                <CardHeader>
                  <Heading as="h2" size="md">
                    Demo Account
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack spacing={6} align="start" height="full">
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
                      <Button colorScheme="orange" size="lg">
                        View Demo
                      </Button>
                    </Link>
                  </VStack>
                </CardBody>
              </Card>
            </HStack>
          </VStack>
          <Text fontSize="14px">
            Having issues? Messages not visible yet? Check out our{" "}
            <Link
              textDecoration="underline"
              href="https://docs.langwatch.ai/support"
              target="_blank"
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
