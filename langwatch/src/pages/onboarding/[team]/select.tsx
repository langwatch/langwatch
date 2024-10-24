import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Heading,
  Image,
  ListItem,
  RadioGroup,
  Spacer,
  Text,
  UnorderedList,
  VStack,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { TrendingUp } from "react-feather";
import {
  useForm,
  type SubmitHandler,
  type UseFormRegister,
} from "react-hook-form";
import { PuzzleIcon } from "~/components/icons/Puzzle";
import { SetupLayout } from "~/components/SetupLayout";
import { type ProjectFormData } from "~/components/TechStack";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { api } from "../../../utils/api";

export default function ProjectOnboardingSelect() {
  useRequiredSession();

  const form = useForm<ProjectFormData>({
    defaultValues: {
      projectType: "",
    },
  });
  const { watch, register, setValue } = form;

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

  useEffect(() => {
    if (team.data) {
      form.setValue("teamId", team.data.id);
    }
  }, [form, team.data]);

  const createProject = api.project.create.useMutation();
  const apiContext = api.useContext();

  const selectedValueProjectType = watch("projectType");

  const onSubmit: SubmitHandler<ProjectFormData> = () => {
    if (!team.data) return;

    createProject.mutate({
      organizationId: organization?.id ?? "",
      teamId: team.data.id,
      name: team.data.name,
      language: "other",
      framework: "other",
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void (async () => {
        await apiContext.organization.getAll.refetch();
        // For some reason even though we await for the refetch it's not done yet when we move pages
        setTimeout(() => {
          if (selectedValueProjectType === "optimization") {
            void router.push(`/${createProject.data.projectSlug}/workflows`);
          } else {
            void router.push(`/${createProject.data.projectSlug}/messages`);
          }
        }, 1000);
      })();
    }
  }, [
    apiContext.organization,
    apiContext.organization.getAll,
    createProject.data?.projectSlug,
    createProject.isSuccess,
    router,
    selectedValueProjectType,
  ]);

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  const projectTypes = {
    optimization: {
      heading: "Optimization Studio",
      icon: <PuzzleIcon />,
      image: "/images/optimization.png",
      text: (
        <UnorderedList>
          <ListItem>
            <b>Ensure quality</b> with a single click
          </ListItem>
          <ListItem>
            <b>Upload your datasets</b> for easy performance tracking
          </ListItem>
          <ListItem>
            <b>Automatically evaluate</b> the performance of your models
          </ListItem>
          <ListItem>
            <b>Optimize</b> your solution using advanced DSPy algorithms in a
            single click
          </ListItem>
        </UnorderedList>
      ),
    },
    monitoring: {
      heading: "Monitoring and Analytics",
      icon: <TrendingUp />,
      image: "/images/analytics.png",
      text: (
        <UnorderedList>
          <ListItem>
            Gain <b>full visibility</b> into your LLM features
          </ListItem>
          <ListItem>
            Add <b>evaluations and guardrails</b> from 30+ libraries or{" "}
            <b>build your own</b>
          </ListItem>
          <ListItem>
            <b>Get alerts</b> to slack or e-mail of any errors
          </ListItem>
          <ListItem>
            Share the performance via <b>Analytics</b> to anyone
          </ListItem>
        </UnorderedList>
      ),
    },
  };

  return (
    <SetupLayout maxWidth="6xl">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          <Heading as="h1" fontSize="x-large">
            Let’s kick things off by monitoring, evaluating, and optimizing your
            LLMs! 🚀
          </Heading>

          <Text paddingBottom={4} fontSize="14px">
            With LangWatch, you’ve got two awesome solutions at your fingertips,
            and you can totally use both! Just pick one to get started below.
            <br />
          </Text>

          <FormControl isInvalid={!!form.formState.errors.projectType}>
            <RadioGroup
              value={selectedValueProjectType ?? ""}
              onChange={(value) => setValue("projectType", value)}
            >
              <Box>
                <HStack width="full" height="100%" alignItems="start">
                  {Object.entries(projectTypes).map(([value, details]) => {
                    return (
                      <CustomRadio
                        key={value}
                        value={value}
                        heading={details.heading}
                        text={details.text}
                        image={details.image}
                        icon={details.icon}
                        registerProps={register("projectType", {
                          required: "Please select a project type",
                        })}
                        selectedValue={selectedValueProjectType ?? ""}
                      />
                    );
                  })}
                </HStack>
              </Box>
            </RadioGroup>
            <FormErrorMessage>
              {form.formState.errors.projectType?.message}
            </FormErrorMessage>
          </FormControl>

          {createProject.error && <p>Something went wrong!</p>}

          <HStack width="full">
            <Button
              colorScheme="orange"
              type="submit"
              isDisabled={createProject.isLoading}
              onClick={() => {
                form.handleSubmit(onSubmit);
              }}
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

const CustomRadio = ({
  value,
  registerProps,
  selectedValue,
  heading,
  text,
  image,
  icon,
}: {
  value: string;
  registerProps: ReturnType<UseFormRegister<ProjectFormData>>;
  selectedValue: string;
  heading: string;
  text: React.ReactNode;
  image: string;
  icon: React.ReactNode;
}) => {
  return (
    <Box as="label" key={value} width="50%">
      <input
        type="radio"
        value={value}
        {...registerProps}
        checked={selectedValue === value} // Add checked prop
        style={{ display: "none" }} // Hide default radio button
      />
      <Card
        borderWidth="1px"
        height="100%"
        _hover={{
          borderWidth: "1px",
          borderColor: "orange.500",
          cursor: "pointer",
        }}
        borderColor={selectedValue === value ? "orange.500" : "gray.300"}
        _checked={{
          borderColor: "orange.500",
        }}
        _active={{ borderColor: "orange.600" }}
      >
        <CardHeader>
          <Heading size="md">
            <HStack>
              {icon}
              <Text>{heading}</Text>
            </HStack>
          </Heading>
          <HStack padding={6}>
            {/* {icon} */}
            <Spacer />
            <Image src={image} alt={heading} width="300px" height="200px" />
            <Spacer />
          </HStack>
        </CardHeader>
        <CardBody>{text}</CardBody>
      </Card>
    </Box>
  );
};
