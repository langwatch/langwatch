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
  type UseRadioProps,
  Select,
  Alert,
  AlertIcon,
  Tooltip,
  Link,
  Card,
  CardHeader,
  CardBody,
  Image,
  Spacer,
  RadioGroup,
  FormErrorMessage,
  List,
  ListItem,
  ListIcon,
  OrderedList,
  UnorderedList,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect, type PropsWithChildren } from "react";
import {
  useForm,
  type SubmitHandler,
  type UseFormRegister,
} from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { Plus } from "react-feather";
import {
  TechStackSelector,
  type ProjectFormData,
} from "~/components/TechStack";
import { api } from "../../../utils/api";

export default function ProjectOnboardingSelect() {
  useRequiredSession();

  const form = useForm<ProjectFormData>({
    defaultValues: {
      projectType: "",
    },
  });
  const { watch, register, setValue, formState } = form;

  console.log("formState", formState);

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

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    console.log("onSubmit", data);
    console.log("team", team.data);
    if (!team.data) return;

    createProject.mutate({
      organizationId: organization?.id ?? "",
      teamId: team.data.id,
      name: teamSlug ?? "",
      language: "other",
      framework: "other",
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void (async () => {
        await apiContext.organization.getAll.refetch();
        console.log("createProject.data", createProject.data);
        console.log("selectedValueProjectType", selectedValueProjectType);
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
  ]);

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  const projectTypes = {
    optimization: {
      heading: "LangWatch Optimization Studio",
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
            Automatically evaluate the efficiency of your models
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
      image: "/images/monitoring.avif",
      text: (
        <UnorderedList>
          <ListItem>
            Gain <b>full visibility</b> into your LLM features
          </ListItem>
          <ListItem>
            Add <b>evaluations</b> (from our library or bring your OWN) and{" "}
            <b>guardrails</b> to your LLM-app
          </ListItem>
          <ListItem>
            <b>Add alerts</b> to slack or e-mail of any errors or
            non-qualitative outputs.
          </ListItem>
          <ListItem>
            Share user-insights (topics, feedback) & product performance via our{" "}
            <b>Analytics Dashboard.</b>
          </ListItem>
          <ListItem>
            <b>Create datasets</b> from real-world user data
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
            Select your solution
          </Heading>

          <Text paddingBottom={4} fontSize="14px">
            We offer two solutions to get started with LangWatch
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
                alert("clicked");
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
}: {
  value: string;
  registerProps: ReturnType<UseFormRegister<ProjectFormData>>;
  selectedValue: string;
  heading: string;
  text: React.ReactNode;
  image: string;
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
          <Heading size="md">{heading}</Heading>
          <HStack>
            <Spacer />
            <Image
              src={image}
              alt={heading}
              marginTop={4}
              width={320}
              height={200}
            />
            <Spacer />
          </HStack>
        </CardHeader>
        <CardBody>{text}</CardBody>
      </Card>
    </Box>
  );
};
