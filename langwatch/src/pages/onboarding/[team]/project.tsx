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
import { type Team } from "@prisma/client";
import { type GetServerSideProps, type GetServerSidePropsContext } from "next";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect, type PropsWithChildren } from "react";
import { Code } from "react-feather";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { api } from "~/utils/api";
import { JavaScript } from "../../../components/icons/JavaScript";
import { OpenAI } from "../../../components/icons/OpenAI";
import { Python } from "../../../components/icons/Python";
import { withSignedInUser } from "../../../server/props";
import { getServerSideHelpers } from "../../../utils/serverHelpers";

type ProjectFormData = {
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

type Props = {
  team: Team | null;
};

export default function ProjectOnboarding({ team }: Props) {
  const { register, handleSubmit, setValue, getValues } =
    useForm<ProjectFormData>({
      defaultValues: {
        language: "python",
        framework: "openai",
      },
    });

  const router = useRouter();

  const createProject = api.project.create.useMutation();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team) return;

    createProject.mutate({
      name: data.name,
      teamId: team.id,
      language: data.language,
      framework: data.framework,
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void router.push("/");
    }
  }, [createProject.isSuccess, router]);

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

  const languageOptions = [
    {
      value: "python",
      label: "Python",
      icon: <Python />,
    },
    {
      value: "javascript",
      label: "JavaScript",
      icon: <JavaScript />,
    },
    { value: "other", label: "Other", icon: <Code /> },
  ];

  const frameworkOptions = [
    {
      value: "openai",
      label: "OpenAI",
      icon: <OpenAI />,
      languages: ["python", "javascript"],
    },
    {
      value: "langchain",
      label: "LangChain",
      icon: <Box fontSize="32px">🦜</Box>,
      languages: ["python", "javascript"],
    },
    {
      value: "other",
      label: "Other",
      languages: ["python", "javascript", "other"],
      icon: <Code />,
    },
  ];

  const {
    getRootProps: languageGetRootProps,
    getRadioProps: languageGetRadioProps,
  } = useRadioGroup({
    name: "language",
    defaultValue: languageOptions[0]?.value,
    onChange: (value) => {
      const availableForLanguage = frameworkOptions.filter((option) =>
        option.languages.includes(value)
      );
      setValue("language", value);
      if (availableForLanguage[0]) {
        setValue("framework", availableForLanguage[0].value);
      }
    },
  });
  const {
    getRootProps: frameworkGetRootProps,
    getRadioProps: frameworkGetRadioProps,
  } = useRadioGroup({
    name: "framework",
    defaultValue: frameworkOptions[0]?.value,
    onChange: (value) => setValue("framework", value),
  });

  const languageGroup = languageGetRootProps();
  const frameworkGroup = frameworkGetRootProps();
  const currentLanguage = getValues("language");
  const currentFramework = getValues("framework");

  if (!team) {
    return <ErrorPage statusCode={404} />;
  }

  register("language", { required: true });
  register("framework", { required: true });

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
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
            <Input {...register("name", { required: true })} />
          </FormControl>
          <FormControl>
            <FormLabel>Language</FormLabel>
            <HStack
              {...languageGroup}
              spacing={6}
              alignItems="stretch"
              wrap="wrap"
            >
              {languageOptions.map((option) => {
                const radio = languageGetRadioProps({ value: option.value });
                return (
                  <RadioCard
                    key={option.value}
                    {...radio}
                    isChecked={currentLanguage == option.value}
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
              {frameworkOptions
                .filter((option) => option.languages.includes(currentLanguage))
                .map((option) => {
                  const radio = frameworkGetRadioProps({ value: option.value });
                  return (
                    <RadioCard
                      key={option.value}
                      {...radio}
                      isChecked={currentFramework == option.value}
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

export const getServerSideProps = withSignedInUser(
  async (context: GetServerSidePropsContext) => {
    const helpers = await getServerSideHelpers(context);
    const { team: teamSlug } = context.query;
    const team =
      typeof teamSlug == "string"
        ? await helpers.team.getBySlug.fetch({ slug: teamSlug })
        : null;

    return {
      props: {
        team,
      },
    };
  }
) satisfies GetServerSideProps<Props>;
