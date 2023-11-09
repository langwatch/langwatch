import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Text,
  VStack,
  useRadio,
  useRadioGroup,
  type UseRadioProps,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect, type PropsWithChildren } from "react";
import { Code } from "react-feather";
import {
  useForm,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { api } from "~/utils/api";
import { JavaScript } from "../../../components/icons/JavaScript";
import { OpenAI } from "../../../components/icons/OpenAI";
import { Python } from "../../../components/icons/Python";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

export type ProjectFormData = {
  name: string;
  language: string;
  framework: string;
};

function RadioCard(props: UseRadioProps & PropsWithChildren) {
  const { getInputProps, getRadioProps } = useRadio(props);

  const input = getInputProps();
  const checkbox = getRadioProps();

  return (
    <Box height="auto" as="label">
      <input {...input} />
      <Box
        {...checkbox}
        cursor="pointer"
        // borderWidth="1px"
        borderRadius="md"
        // boxShadow="md"
        _hover={{
          backgroundColor: "gray.50",
        }}
        _checked={{
          // borderColor: "orange.600",
          backgroundColor: "gray.100",
          // borderWidth: "2px"
        }}
        px={5}
        py={3}
        height="full"
        display="flex"
        alignItems="center"
      >
        {props.children}
      </Box>
    </Box>
  );
}

export default function ProjectOnboarding() {
  useRequiredSession();

  const form = useForm<ProjectFormData>({
    defaultValues: {
      language: "python",
      framework: "openai",
    },
  });

  const router = useRouter();
  const { organization } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const { team: teamSlug } = router.query;
  const team = api.team.getBySlug.useQuery(
    {
      slug: typeof teamSlug == "string" ? teamSlug : "",
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization }
  );

  const createProject = api.project.create.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team.data) return;

    createProject.mutate({
      name: data.name,
      teamId: team.data.id,
      language: data.language,
      framework: data.framework,
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void (async () => {
        await apiContext.organization.getAll.refetch();
        void router.push(`/${createProject.data.projectSlug}`);
      })();
    }
  }, [
    apiContext.organization,
    apiContext.organization.getAll,
    createProject.data?.projectSlug,
    createProject.isSuccess,
    router,
  ]);

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          <Heading as="h1" fontSize="x-large">
            Create New Project
          </Heading>
          <Text paddingBottom={4} fontSize="14px">
            You can set up separate projects for each service or LLM feature of
            your application (for example, one for your ChatBot, another for
            that Content Generation feature).
            <br />
          </Text>
          <FormControl>
            <FormLabel>Project Name</FormLabel>
            <Input {...form.register("name", { required: true })} />
          </FormControl>
          <TechStackSelector form={form} />
          {createProject.error && <p>Something went wrong!</p>}
          <HStack width="full">
            <Button
              colorScheme="orange"
              type="submit"
              disabled={createProject.isLoading}
            >
              {createProject.isLoading || createProject.isSuccess
                ? "Loading..."
                : "Next"}
            </Button>
          </HStack>
        </VStack>
      </form>
    </SetupLayout>
  );
}

export const techStackLanguageOptions = {
  python: {
    label: "Python",
    icon: <Python />,
  },
  javascript: {
    label: "JavaScript",
    icon: <JavaScript />,
  },
  other: { label: "Other", icon: <Code /> },
};

export const techStackFrameworkOptions = {
  openai: {
    label: "OpenAI",
    icon: <OpenAI />,
    languages: ["python", "javascript"],
  },
  langchain: {
    label: "LangChain",
    icon: <Box fontSize="32px">🦜</Box>,
    languages: ["python", "javascript"],
  },
  other: {
    label: "Other",
    icon: <Code />,
    languages: ["python", "javascript", "other"],
  },
};

export const TechStackSelector = ({
  form,
}: {
  form: UseFormReturn<ProjectFormData>;
}) => {
  const IconWrapper = ({ children }: PropsWithChildren) => {
    return (
      <Box
        width="32px"
        height="32px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </Box>
    );
  };

  const {
    getRootProps: languageGetRootProps,
    getRadioProps: languageGetRadioProps,
  } = useRadioGroup({
    name: "language",
    defaultValue: Object.keys(techStackLanguageOptions)[0],
    onChange: (value) => {
      const availableForLanguage = Object.entries(
        techStackFrameworkOptions
      ).filter(([_, framework]) => framework.languages.includes(value));
      form.setValue("language", value);
      if (availableForLanguage[0]) {
        form.setValue("framework", availableForLanguage[0][0]);
      }
    },
  });
  const {
    getRootProps: frameworkGetRootProps,
    getRadioProps: frameworkGetRadioProps,
  } = useRadioGroup({
    name: "framework",
    defaultValue: Object.keys(techStackFrameworkOptions)[0],
    onChange: (value) => form.setValue("framework", value),
  });

  const languageGroup = languageGetRootProps();
  const frameworkGroup = frameworkGetRootProps();
  const currentLanguage = form.getValues("language");
  const currentFramework = form.getValues("framework");

  form.register("language", { required: true });
  form.register("framework", { required: true });

  return (
    <>
      <FormControl>
        <FormLabel>Language</FormLabel>
        <HStack {...languageGroup} spacing={6} alignItems="stretch" wrap="wrap">
          {Object.entries(techStackLanguageOptions).map(([key, option]) => {
            const radio = languageGetRadioProps({ value: key });
            return (
              <RadioCard
                key={key}
                {...radio}
                isChecked={currentLanguage == key}
              >
                <VStack width="64px">
                  <IconWrapper>{option.icon}</IconWrapper>
                  <Box fontSize="sm" textAlign="center">
                    {option.label}
                  </Box>
                </VStack>
              </RadioCard>
            );
          })}
        </HStack>
      </FormControl>
      <FormControl>
        <FormLabel>Library or Framework</FormLabel>
        <HStack
          {...frameworkGroup}
          spacing={6}
          alignItems="stretch"
          wrap="wrap"
        >
          {Object.entries(techStackFrameworkOptions)
            .filter(([_, option]) => option.languages.includes(currentLanguage))
            .map(([key, option]) => {
              const radio = frameworkGetRadioProps({ value: key });
              return (
                <RadioCard
                  key={key}
                  {...radio}
                  isChecked={currentFramework == key}
                >
                  <VStack width="64px">
                    <IconWrapper>{option.icon}</IconWrapper>
                    <Box fontSize="sm" textAlign="center">
                      {option.label}
                    </Box>
                  </VStack>
                </RadioCard>
              );
            })}
        </HStack>
      </FormControl>
    </>
  );
};
