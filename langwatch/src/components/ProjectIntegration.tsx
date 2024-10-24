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
    <DashboardLayout backgroundColor="white">
      <VStack
        maxWidth="1600"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        alignItems="flex-start"
        width="full"
        spacing={6}
      >
        <HStack align="start">
          <VStack
            align="flex-start"
            spacing={6}
            paddingTop={4}
            borderRightWidth={1}
            borderRightColor="gray.400"
            height="full"
            paddingRight={2}
          >
            <Heading as="h2" size="md">
              Integration checks
            </Heading>
            <IntegrationChecks />
          </VStack>
          <VStack
            align="flex-start"
            spacing={6}
            width="full"
            paddingLeft={2}
            paddingTop={4}
            paddingBottom={4}
          >
            <HStack width={"full"}>
              <Heading as="h2" size="md">
                Integration guides
              </Heading>
              <Spacer />
              {isRefetching && <Spinner />}
            </HStack>
            <Text>
              Follow the instructions on our docs to setup your project with
              LangWatch, this page will update automatically as soon as the
              first messages arrive.
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
            <HStack align="stretch" spacing={6}>
              <Card width="400px">
                <CardHeader>
                  <Heading as="h2" size="md">
                    API Key
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack spacing={6}>
                    <Text>
                      Copy your LangWatch API key to use for the integration
                    </Text>
                    <APIKeyCopyInput />
                  </VStack>
                </CardBody>
              </Card>
              <Card minHeight="full">
                <CardHeader>
                  <Heading as="h2" size="md">
                    Integration Guides
                  </Heading>
                </CardHeader>
                <CardBody>
                  <Link
                    href={integrationDocs.href}
                    isExternal
                    marginLeft="28px"
                  >
                    <HStack align="center" fontSize={18} spacing={4}>
                      <IconWrapper width="36px" height="36px">
                        {techStackLanguageOptions.python.icon}
                      </IconWrapper>
                      <Text>
                        Open {techStackLanguageOptions.python.label} Integration
                        Guide
                      </Text>
                      <ExternalLinkIcon />
                    </HStack>
                  </Link>
                  <Link
                    href={integrationDocs.href}
                    isExternal
                    marginLeft="28px"
                  >
                    <HStack align="center" fontSize={18} spacing={4}>
                      <IconWrapper width="36px" height="36px">
                        {techStackLanguageOptions.typescript.icon}
                      </IconWrapper>
                      <Text>
                        Open {techStackLanguageOptions.typescript.label}{" "}
                        Integration Guide
                      </Text>
                      <ExternalLinkIcon />
                    </HStack>
                  </Link>
                  <Link
                    href={integrationDocs.href}
                    isExternal
                    marginLeft="28px"
                  >
                    <HStack align="center" fontSize={18} spacing={4}>
                      <IconWrapper width="36px" height="36px">
                        {techStackLanguageOptions.other.icon}
                      </IconWrapper>
                      <Text>Open Custom REST Integration Guide</Text>
                      <ExternalLinkIcon />
                    </HStack>
                  </Link>
                </CardBody>
              </Card>
              <Card width="300px">
                <CardHeader>
                  <Heading as="h2" size="md">
                    Demo Account
                  </Heading>
                </CardHeader>
                <CardBody>
                  <VStack spacing={6} align="start">
                    <Text>
                      View our demo account to see how LangWatch works with a
                      sample chatbot.
                    </Text>
                    <Link href={`https://app.langwatch.ai/demo`} isExternal>
                      <Button colorScheme="orange" size="lg">
                        View Demo
                      </Button>
                    </Link>
                  </VStack>
                </CardBody>
              </Card>
            </HStack>
          </VStack>
        </HStack>
        <Text fontSize="14px">
          Having issues? Messages not visible yet? Check out our{" "}
          <Link
            textDecoration="underline"
            href="https://docs.langwatch.ai/troubleshooting"
            target="_blank"
          >
            Troubleshooting & Support
          </Link>{" "}
          guide
        </Text>
      </VStack>
    </DashboardLayout>
  );
};
