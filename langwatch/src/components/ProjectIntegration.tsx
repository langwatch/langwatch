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
  Box,
  Card,
  CardHeader,
  CardBody,
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import { APIKeyCopyInput } from "../pages/authorize";
import type { PropsWithChildren } from "react";

export const ProjectIntegration = () => {
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

  const IconWrapper = ({ children }: PropsWithChildren) => {
    return (
      <Box
        width="64px"
        height="64px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </Box>
    );
  };

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
            <Heading as="h1">
              {framework?.label} {language?.label} Integration
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
          <HStack align="stretch" spacing={6} wrap="wrap">
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
            <Card width="450px" minHeight="full">
              <CardHeader>
                <Heading as="h2" size="md">
                  Integration Guide
                </Heading>
              </CardHeader>
              <CardBody>
                <Link href={integrationDocs.href} isExternal marginLeft="28px">
                  <HStack align="center" fontSize={18} spacing={4}>
                    <IconWrapper>{integrationDocs.icon}</IconWrapper>
                    <Text>Open {integrationDocs.label} Integration Guide</Text>
                    <ExternalLinkIcon />
                  </HStack>
                </Link>
              </CardBody>
            </Card>
          </HStack>
          {process.env.NEXT_PUBLIC_DEMO_SLUG && (
            <Text>
              You can also open our{" "}
              <Link
                textDecoration="underline"
                href={`https://app.langwatch.ai/${process.env.NEXT_PUBLIC_DEMO_SLUG}`}
                target="_blank"
              >
                demo account
              </Link>{" "}
              to look around, we have a sample chatbot integrated there so you
              can explore.
            </Text>
          )}
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
