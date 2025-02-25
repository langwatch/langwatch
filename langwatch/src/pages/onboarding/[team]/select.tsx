import {
  Box,
  Card,
  Field,
  HStack,
  Heading,
  Image,
  List,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { TrendingUp } from "react-feather";
import { PuzzleIcon } from "~/components/icons/PuzzleIcon";
import { SetupLayout } from "~/components/SetupLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { api } from "../../../utils/api";

export default function ProjectOnboardingSelect() {
  useRequiredSession();

  const router = useRouter();
  const { organization, project } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  if (project) {
    void router.push(`/${project.slug}`);
  }

  const { team: teamSlug } = router.query;
  const team = api.team.getBySlug.useQuery(
    {
      slug: typeof teamSlug == "string" ? teamSlug : "",
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization }
  );

  const createProject = api.project.create.useMutation();

  const onSubmit = (projectType: string) => {
    if (!team.data) return;
    if (createProject.isLoading) return;

    createProject.mutate(
      {
        organizationId: organization?.id ?? "",
        teamId: team.data.id,
        name: team.data.name,
        language: "other",
        framework: "other",
      },
      {
        onSuccess: (data) => {
          void (async () => {
            if (projectType === "optimization") {
              window.location.href = `/${data.projectSlug}/workflows`;
            } else {
              window.location.href = `/${data.projectSlug}/messages`;
            }
          })();
        },
      }
    );
  };

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  const projectTypes = {
    optimization: {
      heading: "Optimization Studio",
      icon: <PuzzleIcon />,
      image: "/images/optimization.png",
      text: (
        <List.Root>
          <List.Item>
            <b>Ensure quality</b> with a single click
          </List.Item>
          <List.Item>
            <b>Upload your datasets</b> for easy performance tracking
          </List.Item>
          <List.Item>
            <b>Automatically evaluate</b> the performance of your models
          </List.Item>
          <List.Item>
            <b>Optimize</b> your solution using advanced DSPy algorithms in a
            single click
          </List.Item>
        </List.Root>
      ),
    },
    monitoring: {
      heading: "Monitoring and Analytics",
      icon: <TrendingUp />,
      image: "/images/analytics.png",
      text: (
        <List.Root>
          <List.Item>
            Gain <b>full visibility</b> into your LLM features
          </List.Item>
          <List.Item>
            Add <b>evaluations and guardrails</b> from 30+ libraries or{" "}
            <b>build your own</b>
          </List.Item>
          <List.Item>
            <b>Get alerts</b> to slack or e-mail of any errors
          </List.Item>
          <List.Item>
            Share the performance via <b>Analytics</b> to anyone
          </List.Item>
        </List.Root>
      ),
    },
  };

  return (
    <SetupLayout maxWidth="6xl">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form>
        <VStack gap={4} alignItems="left">
          <Heading as="h1" fontSize="x-large">
            Let&apos;s kick things off by monitoring, evaluating, and optimizing
            your LLMs! 🚀
          </Heading>

          <Text paddingBottom={4} fontSize="14px">
            With LangWatch, you&apos;ve got two awesome solutions at your
            fingertips, and you can totally use both! Just pick one to get
            started below.
            <br />
          </Text>

          <Field.Root>
            <Box>
              <SimpleGrid columns={[1, null, 2]} gap="20px">
                {Object.entries(projectTypes).map(([value, details]) => {
                  return (
                    <Box
                      key={value}
                      onClick={(e) => {
                        e.preventDefault();
                        if (createProject.isLoading) return;
                        void onSubmit(value);
                      }}
                      height="100%"
                      padding={0}
                      margin={0}
                    >
                      <CustomRadio
                        key={value}
                        value={value}
                        heading={details.heading}
                        text={details.text}
                        image={details.image}
                        icon={details.icon}
                        disabled={createProject.isLoading}
                      />
                    </Box>
                  );
                })}
              </SimpleGrid>
            </Box>
          </Field.Root>

          {createProject.error && <p>Something went wrong!</p>}
        </VStack>
      </form>
    </SetupLayout>
  );
}

const CustomRadio = ({
  value,
  heading,
  text,
  image,
  icon,
  disabled,
}: {
  value: string;
  heading: string;
  text: React.ReactNode;
  image: string;
  icon: React.ReactNode;
  disabled: boolean;
}) => {
  return (
    <Box as="label" key={value} width="50%">
      <input
        type="radio"
        value={value}
        style={{ display: "none" }}
        disabled={disabled}
      />
      <Card.Root
        borderWidth="1px"
        height="100%"
        _hover={{
          borderWidth: "1px",
          borderColor: "orange.500",
          cursor: "pointer",
        }}
        borderColor="gray.300"
        _checked={{
          borderColor: "orange.500",
        }}
        _active={{ borderColor: "orange.600" }}
      >
        <Card.Header>
          <Heading size="md">
            <HStack>
              {icon}
              <Text>{heading}</Text>
            </HStack>
          </Heading>
          <HStack padding={6}>
            <Spacer />
            <Image src={image} alt={heading} width="300px" height="200px" />
            <Spacer />
          </HStack>
        </Card.Header>
        <Card.Body>{text}</Card.Body>
      </Card.Root>
    </Box>
  );
};
