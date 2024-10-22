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
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import { APIKeyCopyInput } from "../pages/authorize";
import { api } from "../utils/api";
import { IconWrapper } from "./IconWrapper";

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
        <VStack
          align="flex-start"
          spacing={6}
          borderBottomWidth={1}
          borderBottomColor="gray.400"
          width="full"
          paddingTop={6}
          paddingBottom={6}
        >
          <HStack width={"full"}>
            <Heading as="h1">Integration guides</Heading>
            <Spacer />
            {isRefetching && <Spinner />}
          </HStack>
          <Text>
            Follow the instructions on our docs to setup your project with
            LangWatch, this page will update automatically as soon as the first
            messages arrive.
          </Text>
          <Text>
            You can also view our{" "}
            <Link
              textDecoration="underline"
              href={`https://app.langwatch.ai/demo`}
              target="_blank"
            >
              demo account
            </Link>{" "}
            to look around, we have a sample chatbot integrated there so you can
            explore.
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
          <HStack align="stretch" spacing={6} wrap="wrap">
            <Card width="450px">
              <CardHeader>
                <Heading as="h2" size="md">
                  Start Monitoring
                </Heading>
              </CardHeader>
              <CardBody>
                <UnorderedList>
                  <ListItem>
                    Gain <b>full visibility</b> into your LLM features
                  </ListItem>
                  <ListItem>
                    Add <b>evaluations</b> from our library or bring your OWN
                    and <b>guardrails</b> to your LLM-app
                  </ListItem>
                  <ListItem>
                    <b>Add alerts</b> to slack or e-mail of any errors or
                    non-qualitative outputs.
                  </ListItem>
                  <ListItem>
                    Share user-insights (topics, feedback) & product performance
                    via our <b>Analytics Dashboard.</b>
                  </ListItem>
                  <ListItem>
                    <b>Create datasets</b> from real-world user data
                  </ListItem>
                </UnorderedList>
              </CardBody>
            </Card>

            <Card width="450px" minHeight="full">
              <CardHeader>
                <Heading as="h2" size="md">
                  Integration Guides
                </Heading>
              </CardHeader>
              <CardBody>
                <Link href={integrationDocs.href} isExternal marginLeft="28px">
                  <HStack align="center" fontSize={18} spacing={4}>
                    <IconWrapper>
                      {techStackLanguageOptions.python.icon}
                    </IconWrapper>
                    <Text>
                      Open {techStackLanguageOptions.python.label} Integration
                      Guide
                    </Text>
                    <ExternalLinkIcon />
                  </HStack>
                </Link>
                <Link href={integrationDocs.href} isExternal marginLeft="28px">
                  <HStack align="center" fontSize={18} spacing={4}>
                    <IconWrapper>
                      {techStackLanguageOptions.typescript.icon}
                    </IconWrapper>
                    <Text>
                      Open {techStackLanguageOptions.typescript.label}{" "}
                      Integration Guide
                    </Text>
                    <ExternalLinkIcon />
                  </HStack>
                </Link>
                <Link href={integrationDocs.href} isExternal marginLeft="28px">
                  <HStack align="center" fontSize={18} spacing={4}>
                    <IconWrapper>
                      {techStackLanguageOptions.other.icon}
                    </IconWrapper>
                    <Text>Open Custom REST Integration Guide</Text>
                    <ExternalLinkIcon />
                  </HStack>
                </Link>
              </CardBody>
            </Card>
            <Card width="450px">
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
          </HStack>
        </VStack>
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
