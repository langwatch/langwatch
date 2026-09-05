/**
 * The organization and its project, at `/settings`.
 *
 * TWO FORMS BEHIND ONE ADDRESS: the organization's own settings — name, object
 * storage, the two switches, the support contact and the primary use — and, when
 * the organization has a shared project, that project's settings underneath.
 *
 * A PERSONAL WORKSPACE IS NOT THE ORGANIZATION'S PROJECT. `isPersonal` is
 * checked before the second form renders at all: offering somebody's personal
 * workspace here — or offering to "set it up" — would put a private surface
 * inside an organization's settings.
 *
 * THE PRIMARY USE MOVES WHERE `/` LANDS (ADR-038). Switching to LLMOps is saved
 * first and only then checked for what is missing: no project at all offers to
 * create one, and a project that has never received data offers its setup. The
 * save never waits on either.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

import {
  Badge,
  Button,
  createListCollection,
  Field,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import isEqual from "lodash-es/isEqual";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import {
  DepartmentPicker,
  useDepartmentColumn,
} from "@langwatch/organization-web/screens/organization";
import { api } from "../../behavior/project-api";
import {
  useProjectHost,
  type ProjectHostOrganization,
  type ProjectHostProject,
} from "../../model/project-host";
import { HorizontalFormControl } from "../../ui/elements/horizontal-form-control";
import type { OrganizationIntent } from "../../model/prisma-types";
import { ProjectTechStackIcon, TechStackSelector } from "../../ui/blocks/tech-stack";

type OrganizationFormData = {
  name: string;
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  supportContact: string;
  primaryIntent: "" | OrganizationIntent;
};

/**
 * ADR-038 "Primary use": decides where "/" lands for everyone in the org.
 * "Not set" keeps the pre-fork behavior (legacy resolver).
 */
const primaryUseCollection = createListCollection({
  items: [
    { label: "Not set", value: "" },
    { label: "Track AI coding agents", value: "AGENT_GOVERNANCE" },
    { label: "Monitor & evaluate LLM apps", value: "LLM_OPS" },
  ],
});

/** "Admin only" lock badge for settings a non-manager can see but not change. */
function AdminOnlyBadge() {
  return (
    <Badge colorPalette="blue" variant="surface" size={"xs"}>
      <Tooltip content="Contact your admin to change this setting">
        <HStack>
          <Lock size={10} />
          <Text>Admin only</Text>
        </HStack>
      </Tooltip>
    </Badge>
  );
}

/** The grant the platform page asked for, unchanged. */
export const PROJECT_SETTINGS_PAGE_PERMISSION = "organization:view";

export default function ProjectSettingsScreen() {
  const host = useProjectHost();
  const organization = host.organization();
  const project = host.project();

  // Project is optional: a governance-intent org has none by design
  // (ADR-038 v6) and still needs its organization settings. A personal
  // workspace project counts as absent here — org settings must never
  // surface (or offer to "set up") someone's personal workspace.
  const sharedProject = project && !project.isPersonal ? project : undefined;

  if (!organization) return null;

  return <SettingsForm organization={organization} project={sharedProject} />;
}

function SettingsForm({
  organization,
  project,
}: {
  organization: ProjectHostOrganization;
  project: ProjectHostProject | undefined;
}) {
  const host = useProjectHost();
  const hasPermission = (permission: string) => host.hasPermission(permission);
  const isLiteMember = host.isLiteMember();
  // ADR-038: the Primary use setting only exists where the governance
  // surface it routes to is reachable (flag on, which is the default).
  // ADR-038: the flag is asked for the ORGANIZATION and for no project — the
  // page holds none of its own, which `NOT_TARGETED` is what says.
  void NOT_TARGETED;
  const governanceEnabled = host.isFeatureEnabled("release_ui_ai_governance_enabled");
  const [defaultValues, setDefaultValues] = useState<OrganizationFormData>({
    name: organization.name,
    s3Endpoint: organization.s3Endpoint ?? "",
    s3AccessKeyId: organization.s3AccessKeyId ?? "",
    s3SecretAccessKey: organization.s3SecretAccessKey ?? "",
    s3Bucket: organization.s3Bucket ?? "",
    presenceEnabled: organization.presenceEnabled,
    traceSharingEnabled: organization.traceSharingEnabled,
    supportContact: (organization as { supportContact?: string | null }).supportContact ?? "",
    primaryIntent: organization.primaryIntent ?? "",
  });
  const { register, handleSubmit, getFieldState, control } = useForm({
    defaultValues,
  });
  const updateOrganization = api.organization.update.useMutation();
  const apiContext = api.useUtils();
  const [showLlmOpsSetupDialog, setShowLlmOpsSetupDialog] = useState(false);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);

  const onSubmit: SubmitHandler<OrganizationFormData> = (data: OrganizationFormData) => {
    if (isEqual(data, defaultValues)) return;

    const previousIntent = defaultValues.primaryIntent;
    setDefaultValues(data);

    updateOrganization.mutate(
      {
        organizationId: organization.id,
        name: data.name,
        s3Endpoint: data.s3Endpoint,
        s3AccessKeyId: data.s3AccessKeyId,
        s3SecretAccessKey: data.s3SecretAccessKey,
        s3Bucket: data.s3Bucket,
        presenceEnabled: data.presenceEnabled,
        traceSharingEnabled: data.traceSharingEnabled,
        supportContact: data.supportContact.trim() || null,
        primaryIntent: data.primaryIntent === "" ? null : data.primaryIntent,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          void apiContext.governance.resolveHome.invalidate();
          // ADR-038 F9/v6: switching to LLMOps points "/" at the project
          // home, so the change is checked for what's missing — and the
          // user is only interrupted when something actually is. The save
          // itself always goes through first.
          if (data.primaryIntent === "LLM_OPS" && previousIntent !== "LLM_OPS") {
            if (!project) {
              // No project at all (governance orgs skip it at signup):
              // alert, then offer to create it.
              setShowCreateProjectDialog(true);
            } else if (previousIntent === "AGENT_GOVERNANCE" && !project.firstMessage) {
              // Project exists but never received data: offer its setup.
              setShowLlmOpsSetupDialog(true);
            }
          }
          host.succeeded({
            title: "Organization updated",
            description: "Your organization settings have been saved",
          });
        },
        onError: (error) =>
          host.failed({
            error,
            fallbackTitle: "Failed to update organization",
            description: "Your changes could not be saved. Please try again.",
          }),
      },
    );
  };

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading as="h2">Organization Settings</Heading>
          <Spacer />
          {updateOrganization.isPending && <Spinner />}
        </HStack>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
          <VStack gap={0}>
            <VStack gap={0} width="full">
              <HorizontalFormControl
                label="Name"
                helper="The name of your organization"
                invalid={!!getFieldState("name").error}
              >
                {hasPermission("organization:manage") ? (
                  <>
                    <Input
                      width="full"
                      type="text"
                      {...register("name", {
                        required: true,
                        validate: (value) => value.trim().length > 0,
                      })}
                    />
                    <Field.ErrorText>Name is required</Field.ErrorText>
                  </>
                ) : (
                  <Text>{organization.name}</Text>
                )}
              </HorizontalFormControl>
              <HorizontalFormControl label="Slug" helper="The unique ID of your organization">
                {hasPermission("organization:manage") ? (
                  <Input width="full" disabled type="text" value={organization.slug} />
                ) : (
                  <Text>{organization.slug}</Text>
                )}
              </HorizontalFormControl>
              {project && (
                <HorizontalFormControl
                  label="Project ID"
                  helper="Use this ID when authenticating with API Keys"
                >
                  <Input width="full" disabled type="text" value={project.id} />
                </HorizontalFormControl>
              )}

              <HorizontalFormControl
                label="Support contact"
                helper={
                  "Surfaced to your members in CLI 'contact your admin' messages and the in-app budget-exceeded banner. " +
                  "Accepts an email, a URL pointing at an internal ticketing system, or any short instruction. " +
                  "When empty we fall back to the first admin's email."
                }
              >
                {hasPermission("organization:manage") ? (
                  <Input
                    width="full"
                    type="text"
                    maxLength={500}
                    placeholder="support@your-company.com or https://your.ticketing.system"
                    {...register("supportContact", { maxLength: 500 })}
                  />
                ) : (
                  <Text>
                    {(organization as { supportContact?: string | null }).supportContact || (
                      <Text as="span" color="fg.subtle">
                        Not set
                      </Text>
                    )}
                  </Text>
                )}
              </HorizontalFormControl>

              {governanceEnabled && (
                <HorizontalFormControl
                  label="Primary use"
                  helper={
                    <VStack align="start" gap={1}>
                      <Text>
                        What this organization mainly uses LangWatch for. Decides where everyone
                        lands when opening the app: coding-agent tracking opens the personal usage
                        page, LLM apps open the project home. &quot;Not set&quot; keeps the current
                        behavior.
                      </Text>
                      {!hasPermission("organization:manage") && <AdminOnlyBadge />}
                    </VStack>
                  }
                >
                  {hasPermission("organization:manage") ? (
                    <Controller
                      control={control}
                      name="primaryIntent"
                      render={({ field }) => (
                        <Select.Root
                          collection={primaryUseCollection}
                          value={[field.value]}
                          width="full"
                          onValueChange={(d) =>
                            field.onChange((d.value[0] ?? "") as "" | OrganizationIntent)
                          }
                        >
                          <Select.Trigger background="bg" aria-label="Primary use">
                            <Select.ValueText />
                          </Select.Trigger>
                          <Select.Content>
                            {primaryUseCollection.items.map((item) => (
                              <Select.Item key={item.value} item={item}>
                                {item.label}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      )}
                    />
                  ) : (
                    <Text>
                      {organization.primaryIntent ? (
                        primaryUseCollection.items.find(
                          (item) => item.value === organization.primaryIntent,
                        )?.label
                      ) : (
                        <Text as="span" color="fg.subtle">
                          Not set
                        </Text>
                      )}
                    </Text>
                  )}
                </HorizontalFormControl>
              )}

              <HorizontalFormControl
                label="Live presence"
                helper={
                  <VStack align="start" gap={1}>
                    <Text>
                      Lets teammates see who else is on the site in real time - avatars, cursors,
                      and which view each person is in. Disable to turn it off across every project
                      in this organization.
                    </Text>
                    {!hasPermission("organization:manage") && <AdminOnlyBadge />}
                  </VStack>
                }
              >
                <Controller
                  control={control}
                  name="presenceEnabled"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={({ checked }) => field.onChange(checked)}
                      disabled={!hasPermission("organization:manage")}
                    />
                  )}
                />
              </HorizontalFormControl>

              <HorizontalFormControl
                label="Trace Sharing"
                helper={
                  <VStack align="start" gap={1}>
                    <Text>
                      Lets members create share links to traces. Disable to turn sharing off across
                      every project in this organization and revoke all existing links.
                    </Text>
                    {!hasPermission("organization:manage") && <AdminOnlyBadge />}
                  </VStack>
                }
              >
                <Controller
                  control={control}
                  name="traceSharingEnabled"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={({ checked }) => field.onChange(checked)}
                      disabled={!hasPermission("organization:manage")}
                    />
                  )}
                />
              </HorizontalFormControl>

              {organization.useCustomS3 && (
                <HorizontalFormControl
                  label="S3 Storage"
                  helper="Configure S3 storage to host data on your own infrastructure. Leave empty to use LangWatch's managed storage."
                >
                  {hasPermission("organization:manage") ? (
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
                    <Text>S3 storage configuration is only visible to organization managers</Text>
                  )}
                </HorizontalFormControl>
              )}
            </VStack>

            {!isLiteMember && (
              <HStack width="full" justify="flex-end" paddingTop={4}>
                <Button type="submit" colorPalette="blue" loading={updateOrganization.isPending}>
                  Save Changes
                </Button>
              </HStack>
            )}
          </VStack>
        </form>

        {project && hasPermission("project:update") && <ProjectSettingsForm project={project} />}
      </VStack>

      {/* ADR-038 v6: governance -> LLMOps flip on a project-less org — the
        user must know a project is required before the drawer opens */}
      <Dialog.Root
        open={showCreateProjectDialog}
        onOpenChange={({ open }) => setShowCreateProjectDialog(open)}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>A project is needed</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              Your changes are saved. Monitoring LLM apps happens inside a project, and this
              organization doesn&apos;t have one yet — create your first project so everyone has
              somewhere to land.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button variant="outline" onClick={() => setShowCreateProjectDialog(false)}>
                Later
              </Button>
              <Button
                colorPalette="orange"
                onClick={() => {
                  setShowCreateProjectDialog(false);
                  host.openOverlay("createProject", {
                    navigateOnCreate: true,
                    organizationId: organization.id,
                    defaultTeamId: organization.teams.find((t) => !t.isPersonal)?.id,
                  });
                }}
              >
                Set up project
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      {/* ADR-038 F9: governance -> LLMOps flip offers the project setup */}
      <Dialog.Root
        open={showLlmOpsSetupDialog && !!project}
        onOpenChange={({ open }) => setShowLlmOpsSetupDialog(open)}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Set up your project</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              Everyone in this organization will now land on the project home, but the project
              hasn&apos;t received any data yet. Walk through the project setup so there&apos;s
              something to see when they arrive.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button variant="outline" onClick={() => setShowLlmOpsSetupDialog(false)}>
                Later
              </Button>
              <Button
                colorPalette="orange"
                onClick={() => {
                  // Dialog only opens when a project exists (see open guard).
                  window.location.href = `/onboarding/product?projectSlug=${project?.slug ?? ""}`;
                }}
              >
                Set up the project
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
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
  traceSharingEnabled: boolean;
  presenceEnabled: boolean;
};

function ProjectSettingsForm({ project }: { project: ProjectHostProject }) {
  const host = useProjectHost();
  const organization = host.organization();
  const department = useDepartmentColumn(
    organization?.id ?? "",
    host.isFeatureEnabled("release_ui_ai_governance_enabled"),
  );
  const hasPermission = (permission: string) => host.hasPermission(permission);
  const userIsAdmin = hasPermission("project:manage");

  const defaultValues = {
    name: project.name,
    language: project.language,
    framework: project.framework,
    userLinkTemplate: project.userLinkTemplate ?? "",
    s3Endpoint: project.s3Endpoint ?? "",
    s3AccessKeyId: project.s3AccessKeyId ?? "",
    s3SecretAccessKey: project.s3SecretAccessKey ?? "",
    s3Bucket: project.s3Bucket ?? "",
    traceSharingEnabled: project.traceSharingEnabled,
    presenceEnabled: project.presenceEnabled,
  };
  const [previousValues, setPreviousValues] = useState<ProjectFormData>(defaultValues);
  const form = useForm({
    defaultValues,
  });
  const { register, handleSubmit, control, formState } = form;
  const updateProject = api.project.update.useMutation();
  const apiContext = api.useUtils();
  const [changeLanguageFramework, setChangeLanguageFramework] = useState(false);
  const [showTraceSharingDialog, setShowTraceSharingDialog] = useState(false);

  const handleTraceSharingChange = (newValue: boolean) => {
    // Directly update the form value
    form.setValue("traceSharingEnabled", newValue);
  };

  const confirmDisableTraceSharing = () => {
    setShowTraceSharingDialog(false);
    // Proceed with the form submission
    void handleSubmit(onSubmit)();
  };

  const cancelDisableTraceSharing = () => {
    setShowTraceSharingDialog(false);
  };

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (isEqual(data, previousValues)) return;

    // Check if trace sharing is being disabled
    if (data.traceSharingEnabled === false && project.traceSharingEnabled === true) {
      // Show confirmation dialog before proceeding
      setShowTraceSharingDialog(true);
      return;
    }

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

        // Only admins can change these settings, this is enforced in the backend
        traceSharingEnabled: userIsAdmin ? data.traceSharingEnabled : void 0,
        presenceEnabled: userIsAdmin ? data.presenceEnabled : void 0,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          host.succeeded({
            title: "Project updated",
            description: "Your project settings have been saved",
          });
        },
        onError: (error) =>
          host.failed({
            error,
            fallbackTitle: "Failed to update project",
            description: "Your changes could not be saved. Please try again.",
          }),
      },
    );
  };

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading as="h2">Project-level Settings</Heading>
        <Spacer />
        {updateProject.isPending && <Spinner />}
        {host.projectSwitcher()}
      </HStack>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack gap={0} width="full">
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
                validate: (value) => value.trim().length > 0,
              })}
            />
            <Field.ErrorText>Name is required</Field.ErrorText>
          </HorizontalFormControl>
          {department.show && (
            <HorizontalFormControl
              label="Department"
              helper="Agent spend with no human principal rolls up to this department"
            >
              <DepartmentPicker
                organizationId={organization?.id ?? ""}
                kind="project"
                entityId={project.id}
                value={department.byProject.get(project.id) ?? null}
                departments={department.departments}
                onAssigned={department.refetch}
              />
            </HorizontalFormControl>
          )}
          <HorizontalFormControl
            label="Tech Stack"
            helper="The project language and framework"
            invalid={!!formState.errors.language || !!formState.errors.framework}
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
            label="Live presence"
            helper={
              <VStack align="start" gap={1}>
                <Text>
                  Show teammate avatars, cursors, and active views inside this project.{" "}
                  {!organization?.presenceEnabled
                    ? "Disabled at the organization level - turn it on there first."
                    : "Disable to turn presence off for this project only."}
                </Text>
                {!userIsAdmin && <AdminOnlyBadge />}
              </VStack>
            }
            invalid={!!formState.errors.presenceEnabled}
          >
            <Controller
              control={control}
              name="presenceEnabled"
              render={({ field }) => (
                <Switch
                  checked={field.value && (organization?.presenceEnabled ?? true)}
                  onCheckedChange={({ checked }) => field.onChange(checked)}
                  disabled={!userIsAdmin || !(organization?.presenceEnabled ?? true)}
                />
              )}
            />
          </HorizontalFormControl>

          <HorizontalFormControl
            label="Trace Sharing"
            helper={
              <VStack align="start" gap={1}>
                <Text>
                  Allow users to share traces with public links.{" "}
                  {!organization?.traceSharingEnabled
                    ? "Disabled at the organization level - turn it on there first."
                    : "Disable to turn sharing off for this project only."}
                </Text>
                {!userIsAdmin && <AdminOnlyBadge />}
              </VStack>
            }
            invalid={!!formState.errors.traceSharingEnabled}
          >
            <Controller
              control={control}
              name="traceSharingEnabled"
              render={({ field }) => (
                <Switch
                  checked={field.value && (organization?.traceSharingEnabled ?? true)}
                  onCheckedChange={({ checked }) => handleTraceSharingChange(checked)}
                  disabled={!userIsAdmin || !(organization?.traceSharingEnabled ?? true)}
                />
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
        </VStack>
        <HStack width="full" justify="flex-end" paddingTop={4}>
          <Button type="submit" colorPalette="blue" loading={updateProject.isPending}>
            Save Changes
          </Button>
        </HStack>
      </form>

      {/* Trace Sharing Disable Confirmation Dialog */}
      <Dialog.Root
        open={showTraceSharingDialog}
        onOpenChange={({ open }) => setShowTraceSharingDialog(open)}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Disable Trace Sharing?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="start" gap={4}>
              <Text>
                Are you sure you want to save these changes and disable trace sharing for this
                project?
              </Text>
              <VStack
                align="start"
                gap={2}
                padding={4}
                backgroundColor="orange.subtle"
                borderWidth="1px"
                borderColor="orange.muted"
                borderRadius="md"
              >
                <HStack gap={2}>
                  <Text fontWeight="semibold" color="orange.fg">
                    ⚠️ Warning
                  </Text>
                </HStack>
                <Text fontSize="sm" color="orange.fg">
                  This action will <b>immediately revoke</b> all existing shared trace links. Anyone
                  with previously shared trace URLs will <b>no longer be able to access them</b>.
                </Text>
              </VStack>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button variant="outline" onClick={cancelDisableTraceSharing}>
                Cancel
              </Button>
              <Button colorPalette="red" onClick={confirmDisableTraceSharing}>
                Save & Disable Trace Sharing
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
