import { useForm } from "react-hook-form";
import { type ProjectFormData } from "./TechStack";
import {
  techStackLanguageOptions,
  techStackFrameworkOptions,
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
} from "@chakra-ui/react";
import { DashboardLayout } from "./DashboardLayout";

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

  const form = useForm<ProjectFormData>({
    defaultValues: {
      language: languageKey,
      framework: frameworkKey,
    },
  });

  const IntegrationDocs = languageKey && framework?.languages[languageKey];

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
            Follow the instructions to setup your project with LangWatch, this
            page will update automatically as soon as the first messages arrive
          </Text>
        </VStack>
        <div className="markdown">
          {IntegrationDocs && <IntegrationDocs apiKey={project?.apiKey} />}
        </div>
        <Text fontSize="14px">
          Having issues? Messages not visible yet? Check out our{" "}
          <Link
            textDecoration="underline"
            href="https://docs.langwatch.ai/docs/support"
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
