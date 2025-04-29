import {
  Button,
  Card,
  Field,
  Heading,
  Input,
  Spacer,
  Spinner,
  Text,
  createListCollection,
  Alert,
  Badge,
} from "@chakra-ui/react";
import { PIIRedactionLevel, ProjectSensitiveDataVisibilityLevel, type Project } from "@prisma/client";
import isEqual from "lodash.isequal";
import { useState } from "react";
import {
  useForm,
  useWatch,
  type SubmitHandler,
  Controller,
} from "react-hook-form";
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
import { Tooltip } from "~/components/ui/tooltip";
import { Lock } from "react-feather";

type OrganizationFormData = {
  name: string;
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  elasticsearchNodeUrl: string;
  elasticsearchApiKey: string;
  s3Bucket: string;
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
    s3Endpoint: organization.s3Endpoint ?? "",
    s3AccessKeyId: organization.s3AccessKeyId ?? "",
    s3SecretAccessKey: organization.s3SecretAccessKey ?? "",
    elasticsearchNodeUrl: organization.elasticsearchNodeUrl ?? "",
    elasticsearchApiKey: organization.elasticsearchApiKey ?? "",
    s3Bucket: organization.s3Bucket ?? "",
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateOrganization = api.organization.update.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<OrganizationFormData> = (
    data: OrganizationFormData
  ) => {
    if (isEqual(data, defaultValues)) return;

    setDefaultValues(data);

    updateOrganization.mutate(
      {
        organizationId: organization.id,
        name: data.name,
        s3Endpoint: data.s3Endpoint,
        s3AccessKeyId: data.s3AccessKeyId,
        s3SecretAccessKey: data.s3SecretAccessKey,
        elasticsearchNodeUrl: data.elasticsearchNodeUrl,
        elasticsearchApiKey: data.elasticsearchApiKey,
        s3Bucket: data.s3Bucket,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          toaster.create({
            title: "Organization updated",
            description: "Your organization settings have been saved",
            type: "success",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
        onError: () => {
          toaster.create({
            title: "Failed to update organization",
            description:
              "Please make sure you have filled out all fields related to either S3 or Elasticsearch",
            type: "error",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
      }
    );
  };

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
          <Card.Body width="full" paddingY={2} paddingBottom={4}>
            {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
            <form onSubmit={handleSubmit(onSubmit)}>
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

                {organization.useCustomS3 && (
                  <HorizontalFormControl
                    label="S3 Storage"
                    helper="Configure S3 storage to host data on your own infrastructure. Leave empty to use LangWatch's managed storage."
                  >
                    {hasOrganizationPermission(
                      OrganizationRoleGroup.ORGANIZATION_MANAGE
                    ) ? (
                      <VStack width="full" align="start" gap={3}>
                        <Input
                          width="full"
                          type="text"
                          placeholder="S3 Endpoint"
                          {...register("s3Endpoint")}
                        />
                        <Input
                          width="full"
                          type="text"
                          placeholder="Access Key ID"
                          {...register("s3AccessKeyId")}
                        />
                        <Input
                          width="full"
                          type="password"
                          placeholder="Secret Access Key"
                          {...register("s3SecretAccessKey")}
                        />
                        <Input
                          width="full"
                          type="text"
                          placeholder="S3 Bucket Name"
                          {...register("s3Bucket")}
                        />
                      </VStack>
                    ) : (
                      <Text>
                        S3 storage configuration is only visible to organization
                        managers
                      </Text>
                    )}
                  </HorizontalFormControl>
                )}

                {organization.useCustomElasticsearch && (
                  <HorizontalFormControl
                    label="Elasticsearch"
                    helper="Configure your Elasticsearch instance for advanced search capabilities"
                  >
                    {hasOrganizationPermission(
                      OrganizationRoleGroup.ORGANIZATION_MANAGE
                    ) ? (
                      <VStack width="full" align="start" gap={3}>
                        <Input
                          width="full"
                          type="text"
                          placeholder="Elasticsearch Node URL"
                          {...register("elasticsearchNodeUrl")}
                        />
                        <Input
                          width="full"
                          type="password"
                          placeholder="Elasticsearch API Key"
                          {...register("elasticsearchApiKey")}
                        />
                      </VStack>
                    ) : (
                      <Text>
                        Elasticsearch configuration is only visible to
                        organization managers
                      </Text>
                    )}
                  </HorizontalFormControl>
                )}

                <HStack width="full" justify="flex-end" paddingTop={4}>
                  <Button
                    type="submit"
                    colorPalette="blue"
                    loading={updateOrganization.isLoading}
                  >
                    Save Changes
                  </Button>
                </HStack>
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
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
  piiRedactionLevel: PIIRedactionLevel;
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel;
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel;
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

  const capturedInputVisibilityCollection = createListCollection({
    items: [
      {
        label: "Redacted to All",
        value: ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
        description: "Redacts captured input for all users",
      },
      {
        label: "Visible to Admin",
        value: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        description: "Redacts captured input for all users except admins",
      },
      {
        label: "Visible to All",
        value: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        description: "Does not redact any captured input",
      },
    ],
  });

  const capturedOutputVisibilityCollection = createListCollection({
    items: [
      {
        label: "Redacted to All",
        value: ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
        description: "Redacts captured output for all users",
      },
      {
        label: "Visible to Admin",
        value: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        description: "Redacts captured output for all users except admins",
      },
      {
        label: "Visible to All",
        value: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        description: "Does not redact any captured output",
      },
    ],
  });

  const { hasTeamPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const userIsAdmin = hasTeamPermission(TeamRoleGroup.PROJECT_CHANGE_CAPTURED_DATA_VISIBILITY);

  const defaultValues = {
    name: project.name,
    language: project.language,
    framework: project.framework,
    userLinkTemplate: project.userLinkTemplate ?? "",
    s3Endpoint: project.s3Endpoint ?? "",
    s3AccessKeyId: project.s3AccessKeyId ?? "",
    s3SecretAccessKey: project.s3SecretAccessKey ?? "",
    s3Bucket: project.s3Bucket ?? "",
    piiRedactionLevel: project.piiRedactionLevel,
    capturedInputVisibility: project.capturedInputVisibility,
    capturedOutputVisibility: project.capturedOutputVisibility,
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

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (isEqual(data, previousValues)) return;

    setPreviousValues(data);

    updateProject.mutate(
      {
        projectId: project.id,
        ...data,
        userLinkTemplate: data.userLinkTemplate ?? "",
        s3Endpoint: data.s3Endpoint ?? "",
        s3AccessKeyId: data.s3AccessKeyId ?? "",
        s3SecretAccessKey: data.s3SecretAccessKey ?? "",
        s3Bucket: data.s3Bucket ?? "",

        // Only admins can change the visibility settings, this is enforced in the backend
        capturedInputVisibility: userIsAdmin ? data.capturedInputVisibility : void 0,
        capturedOutputVisibility: userIsAdmin ? data.capturedOutputVisibility : void 0,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          toaster.create({
            title: "Project updated",
            description: "Your project settings have been saved",
            type: "success",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
        onError: () => {
          toaster.create({
            title: "Failed to update project",
            description:
              "Please make sure you have filled out all fields related to S3",
            type: "error",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
      }
    );
  };

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
        <Card.Body width="full" paddingY={2} paddingBottom={4}>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
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

            <HorizontalFormControl
              label="Show Captured Input Data"
              helper={
                <VStack align="start" gap={1}>
                  <Text>Manage who can see input data on traces and spans</Text>
                  {!userIsAdmin && (
                    <Badge colorPalette="blue" variant="surface" size={"xs"}>
                      <Tooltip content="Contact your admin to change this setting">
                        <HStack>
                          <Lock size={10} />
                          <Text>Admin only</Text>
                        </HStack>
                      </Tooltip>
                    </Badge>
                  )}
                </VStack>
              }
              invalid={!!formState.errors.capturedInputVisibility}
            >
              <Controller
                control={control}
                name="capturedInputVisibility"
                rules={{ required: userIsAdmin ? "Captured input visibility is required" : undefined }}
                render={({ field }) => (
                  <Select.Root
                    collection={capturedInputVisibilityCollection}
                    {...field}
                    onChange={undefined}
                    value={[field.value]}
                    onValueChange={(e) => {
                      field.onChange(e.value[0]);
                    }}
                    disabled={!userIsAdmin}
                  >
                    <Select.Trigger width="full">
                      <Select.ValueText placeholder="Select captured input visibility" />
                    </Select.Trigger>
                    <Select.Content width="300px">
                      {capturedInputVisibilityCollection.items.map((option) => (
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
            <HorizontalFormControl
              label="Show Captured Output Data"
              helper={
                <VStack align="start" gap={1}>
                  <Text>Manage who can see output data on traces and spans</Text>
                  {!userIsAdmin && (
                    <Badge colorPalette="blue" variant="surface" size={"xs"}>
                      <Tooltip content="Contact your admin to change this setting">
                        <HStack>
                          <Lock size={10} />
                          <Text>Admin only</Text>
                        </HStack>
                      </Tooltip>
                    </Badge>
                  )}
                </VStack>
              }
              invalid={!!formState.errors.capturedOutputVisibility}
            >
              <Controller
                control={control}
                name="capturedOutputVisibility"
                rules={{ required: userIsAdmin ? "Captured output visibility is required" : undefined }}
                render={({ field }) => (
                  <Select.Root
                    collection={capturedOutputVisibilityCollection}
                    {...field}
                    onChange={undefined}
                    value={[field.value]}
                    onValueChange={(e) => {
                      field.onChange(e.value[0]);
                    }}
                    disabled={!userIsAdmin}
                  >
                    <Select.Trigger width="full">
                      <Select.ValueText placeholder="Select captured output visibility" />
                    </Select.Trigger>
                    <Select.Content width="300px">
                      {capturedInputVisibilityCollection.items.map((option) => (
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

            {organization?.useCustomS3 && (
              <HorizontalFormControl
                label="S3 Storage"
                helper="Configure project-specific S3 storage settings for datasets. If left empty, organization-level settings will be used."
              >
                <VStack width="full" align="start" gap={3}>
                  <Input
                    width="full"
                    type="text"
                    placeholder="S3 Endpoint"
                    {...register("s3Endpoint")}
                  />
                  <Input
                    width="full"
                    type="text"
                    placeholder="Access Key ID"
                    {...register("s3AccessKeyId")}
                  />
                  <Input
                    width="full"
                    type="password"
                    placeholder="Secret Access Key"
                    {...register("s3SecretAccessKey")}
                  />
                  <Input
                    width="full"
                    type="text"
                    placeholder="S3 Bucket Name"
                    {...register("s3Bucket")}
                  />
                </VStack>
              </HorizontalFormControl>
            )}
            <HStack width="full" justify="flex-end" paddingTop={4}>
              <Button
                type="submit"
                colorPalette="blue"
                loading={updateProject.isLoading}
              >
                Save Changes
              </Button>
            </HStack>
          </form>
        </Card.Body>
      </Card.Root>
    </>
  );
}
