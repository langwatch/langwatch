import {
  Button,
  Card,
  Field,
  Heading,
  Input,
  Separator,
  Spacer,
  Spinner,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { PIIRedactionLevel, type Project } from "@prisma/client";
import isEqual from "lodash.isequal";
import { useEffect, useState } from "react";
import {
  useForm,
  useWatch,
  type SubmitHandler,
  Controller,
} from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import { ProjectSelector } from "../components/DashboardLayout";
import SettingsLayout from "../components/SettingsLayout";
import {
  ProjectTechStackIcon,
  TechStackSelector,
} from "../components/TechStack";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { OrganizationRoleGroup, TeamRoleGroup } from "../server/api/permission";
import type { FullyLoadedOrganization } from "../server/api/routers/organization";
import { api } from "../utils/api";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { HStack, VStack } from "@chakra-ui/react";
import { toaster } from "../components/ui/toaster";
import { Select } from "../components/ui/select";

type OrganizationFormData = {
  name: string;
};

export default function Settings() {
  const { organization, project } = useOrganizationTeamProject();

  if (!organization || !project) return null;

  return <SettingsForm organization={organization} project={project} />;
}

function SettingsForm({
  organization,
  project,
}: {
  organization: FullyLoadedOrganization;
  project: Project;
}) {
  const { hasOrganizationPermission, hasTeamPermission } =
    useOrganizationTeamProject();
  const [defaultValues, setDefaultValues] = useState<OrganizationFormData>({
    name: organization.name,
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateOrganization = api.organization.update.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<OrganizationFormData> = useDebouncedCallback(
    (data: OrganizationFormData) => {
      if (isEqual(data, defaultValues)) return;

      setDefaultValues(data);

      updateOrganization.mutate(
        {
          organizationId: organization.id,
          name: data.name,
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
          },
          onError: () => {
            toaster.create({
              title: "Failed to create organization",
              description: "Please try that again",
              type: "error",
              meta: {
                closable: true,
              },
              placement: "top-end",
            });
          },
        }
      );
    },
    250
  );

  useEffect(() => {
    void handleSubmit(onSubmit)();
  }, [formWatch, handleSubmit, onSubmit]);

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full">
          <Heading size="lg" as="h1">
            Organization Settings
          </Heading>
          <Spacer />
          {updateOrganization.isLoading && <Spinner />}
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={2}>
            <form onSubmit={void handleSubmit(onSubmit)}>
              <VStack gap={0}>
                <HorizontalFormControl
                  label="Name"
                  helper="The name of your organization"
                  invalid={!!getFieldState("name").error}
                >
                  {hasOrganizationPermission(
                    OrganizationRoleGroup.ORGANIZATION_MANAGE
                  ) ? (
                    <>
                      <Input
                        width="full"
                        type="text"
                        {...register("name", {
                          required: true,
                          validate: (value) => {
                            if (!value.trim()) return false;
                          },
                        })}
                      />
                      <Field.ErrorText>Name is required</Field.ErrorText>
                    </>
                  ) : (
                    <Text>{organization.name}</Text>
                  )}
                </HorizontalFormControl>
                <HorizontalFormControl
                  label="Slug"
                  helper="The unique ID of your organization"
                >
                  {hasOrganizationPermission(
                    OrganizationRoleGroup.ORGANIZATION_MANAGE
                  ) ? (
                    <Input
                      width="full"
                      disabled
                      type="text"
                      value={organization.slug}
                    />
                  ) : (
                    <Text>{organization.slug}</Text>
                  )}
                </HorizontalFormControl>
              </VStack>
            </form>
          </Card.Body>
        </Card.Root>
        {hasTeamPermission(TeamRoleGroup.SETUP_PROJECT) && (
          <ProjectSettingsForm project={project} />
        )}
      </VStack>
    </SettingsLayout>
  );
}

type ProjectFormData = {
  name: string;
  language: string;
  framework: string;
  userLinkTemplate?: string;
  piiRedactionLevel: PIIRedactionLevel;
};

function ProjectSettingsForm({ project }: { project: Project }) {
  const { organization, organizations } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();

  const piiRedactionLevelCollection = createListCollection({
    items: [
      {
        label: "Strict",
        value: PIIRedactionLevel.STRICT,
        description: "Redacts all PII data including names and addresses",
      },
      {
        label: "Essential",
        value: PIIRedactionLevel.ESSENTIAL,
        description:
          "Redacts only essential PII data like email addresses, phone numbers, credit card numbers and IP addresses",
      },
      ...(!!organization?.signedDPA ||
      !publicEnv.data?.IS_SAAS ||
      publicEnv.data?.NODE_ENV === "development"
        ? [
            {
              label: "Disabled",
              value: PIIRedactionLevel.DISABLED,
              description: "PII data will not be redacted",
            },
          ]
        : []),
    ],
  });

  const defaultValues = {
    name: project.name,
    language: project.language,
    framework: project.framework,
    userLinkTemplate: project.userLinkTemplate ?? "",
    piiRedactionLevel: project.piiRedactionLevel,
  };
  const [previousValues, setPreviousValues] =
    useState<ProjectFormData>(defaultValues);
  const form = useForm({
    defaultValues,
  });
  const { register, handleSubmit, control, formState } = form;
  const formWatch = useWatch({ control });
  const updateProject = api.project.update.useMutation();
  const apiContext = api.useContext();
  const [changeLanguageFramework, setChangeLanguageFramework] = useState(false);

  const onSubmit: SubmitHandler<ProjectFormData> = useDebouncedCallback(
    (data: ProjectFormData) => {
      if (isEqual(data, previousValues)) return;

      setPreviousValues(data);

      updateProject.mutate(
        {
          projectId: project.id,
          ...data,
          userLinkTemplate: data.userLinkTemplate ?? "",
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
          },
          onError: () => {
            toaster.create({
              title: "Failed to create organization",
              description: "Please try that again",
              type: "error",
              meta: {
                closable: true,
              },
              placement: "top-end",
            });
          },
        }
      );
    },
    250
  );

  useEffect(() => {
    void handleSubmit(onSubmit)();
  }, [formWatch, handleSubmit, onSubmit]);

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading size="lg" as="h1">
          Project-level Settings
        </Heading>
        <Spacer />
        {updateProject.isLoading && <Spinner />}
        {organizations && (
          <ProjectSelector organizations={organizations} project={project} />
        )}
      </HStack>
      <Card.Root width="full">
        <Card.Body width="full" paddingY={2}>
          <form onSubmit={void handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="The name of the project"
              invalid={!!formState.errors.name}
            >
              <Input
                width="full"
                type="text"
                {...register("name", {
                  required: true,
                  validate: (value) => {
                    if (!value.trim()) return false;
                  },
                })}
              />
              <Field.ErrorText>Name is required</Field.ErrorText>
            </HorizontalFormControl>
            <HorizontalFormControl
              label="Tech Stack"
              helper="The project language and framework"
              invalid={
                !!formState.errors.language || !!formState.errors.framework
              }
            >
              {changeLanguageFramework ? (
                <TechStackSelector form={form} />
              ) : (
                <HStack>
                  <ProjectTechStackIcon project={project} />
                  <Text>
                    {project.language} / {project.framework}
                  </Text>
                  <Button
                    variant="ghost"
                    textDecoration="underline"
                    onClick={() => setChangeLanguageFramework(true)}
                  >
                    (change)
                  </Button>
                </HStack>
              )}
            </HorizontalFormControl>
            <HorizontalFormControl
              label="PII Redaction Level"
              helper="The level of redaction for PII"
              invalid={!!formState.errors.piiRedactionLevel}
            >
              <Controller
                control={control}
                name="piiRedactionLevel"
                rules={{ required: "PII Redaction Level is required" }}
                render={({ field }) => (
                  <Select.Root
                    collection={piiRedactionLevelCollection}
                    {...field}
                    onChange={undefined}
                    value={[field.value]}
                    onValueChange={(e) => {
                      field.onChange(e.value[0]);
                    }}
                  >
                    <Select.Trigger width="full">
                      <Select.ValueText placeholder="Select PII redaction level" />
                    </Select.Trigger>
                    <Select.Content width="300px">
                      {piiRedactionLevelCollection.items.map((option) => (
                        <Select.Item key={option.value} item={option}>
                          <VStack align="start" gap={0}>
                            <Text>{option.label}</Text>
                            <Text fontSize="13px" color="gray.500">
                              {option.description}
                            </Text>
                          </VStack>
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                )}
              />
            </HorizontalFormControl>
          </form>
        </Card.Body>
      </Card.Root>
    </>
  );
}
