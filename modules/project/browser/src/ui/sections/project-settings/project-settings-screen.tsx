/** Organization and project settings; personal workspaces cannot be the org's project (ADR-038). */

import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { Dialog } from "@langwatch/design-system/dialog";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { IdText } from "@langwatch/design-system/id-text";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Button,
  Box,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import {
  SettingsField,
  SettingsFieldGroup,
  SettingsFieldValue,
} from "@langwatch/design-system/settings-field";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { SectionTitle } from "@langwatch/design-system/typography";
import { FrontendFlags, NOT_TARGETED } from "@langwatch/feature-flag-contract";
import isEqual from "lodash-es/isEqual";
import { Building2, FolderCog, Lock } from "lucide-react";
import { useState } from "react";
import {
  Controller,
  type SubmitHandler,
  type Control,
  type UseFormRegister,
  useForm,
  useFormState,
  useWatch,
} from "react-hook-form";

import { ProjectDepartmentField } from "../../../behavior/lent-peers.tsx";
import { projectApi } from "../../../behavior/project-api.ts";
import type { OrganizationIntent } from "../../../model/prisma-types.ts";
import {
  useProjectHost,
  type ProjectHostOrganization,
  type ProjectHostProject,
} from "../../../model/project-host.ts";
import { ProjectTechStackIcon } from "../../../ui/blocks/tech-stack.tsx";
import { TechStackSelector } from "../../blocks/onboarding/tech-stack.tsx";

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

function setupDialogAfterIntentChange({
  nextIntent,
  previousIntent,
  project,
}: {
  nextIntent: OrganizationIntent | "";
  previousIntent: OrganizationIntent | "";
  project: ProjectHostProject | undefined;
}): "create-project" | "set-up-project" | null {
  if (nextIntent !== "LLM_OPS" || previousIntent === "LLM_OPS") return null;
  if (!project) return "create-project";
  if (previousIntent === "AGENT_GOVERNANCE" && !project.firstMessage) return "set-up-project";
  return null;
}

/** "Admin only" lock badge for settings a non-manager can see but not change. */
function AdminOnlyBadge() {
  return (
    <Badge colorPalette="gray" variant="surface" size={"xs"}>
      <Tooltip content="Contact your admin to change this setting">
        <HStack>
          <Lock size={10} />
          <Text>Admin only</Text>
        </HStack>
      </Tooltip>
    </Badge>
  );
}

function OrganizationIdentityFields({
  canManage,
  control,
  organization,
  project,
  register,
}: {
  canManage: boolean;
  control: Control<OrganizationFormData>;
  organization: ProjectHostOrganization;
  project: ProjectHostProject | undefined;
  register: UseFormRegister<OrganizationFormData>;
}) {
  // A subscription, so a refused save re-renders the field as invalid (WEB-5602 pattern).
  const { errors } = useFormState({ control, name: "name" });
  return (
    <>
      <SettingsField
        label="Name"
        hint="The name of your organization."
        error={errors.name ? "Name is required" : undefined}
      >
        {canManage ? (
          <Input
            width="full"
            type="text"
            {...register("name", {
              required: true,
              validate: (value) => value.trim().length > 0,
            })}
          />
        ) : (
          <SettingsFieldValue>{organization.name}</SettingsFieldValue>
        )}
      </SettingsField>
      <SettingsField label="Slug" hint="The unique ID of your organization.">
        <SettingsFieldValue>
          <IdText value={organization.slug} label="organization slug" />
        </SettingsFieldValue>
      </SettingsField>
      {project ? (
        <SettingsField label="Project ID" hint="Use this ID when authenticating with API keys.">
          <SettingsFieldValue>
            <IdText value={project.id} label="project ID" />
          </SettingsFieldValue>
        </SettingsField>
      ) : null}
      <SettingsField
        label="Support contact"
        hint="Shown to members in 'contact your admin' messages; empty falls back to the first admin's email."
      >
        {canManage ? (
          <Input
            width="full"
            type="text"
            maxLength={500}
            placeholder="support@your-company.com or https://your.ticketing.system"
            {...register("supportContact", { maxLength: 500 })}
          />
        ) : (
          <SettingsFieldValue>
            {organization.supportContact || <EmptyValue label="Not set" />}
          </SettingsFieldValue>
        )}
      </SettingsField>
    </>
  );
}

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

function S3StorageField({
  canManage,
  hasStoredKey,
  register,
}: {
  canManage: boolean;
  hasStoredKey: boolean;
  register: UseFormRegister<OrganizationFormData>;
}) {
  return (
    <SettingsField
      label="S3 storage"
      hint="Host data in your own S3; leave empty to use LangWatch's managed storage."
    >
      {canManage ? (
        <VStack width="full" align="start" gap={3}>
          <Input width="full" type="text" placeholder="S3 endpoint" {...register("s3Endpoint")} />
          <Input
            width="full"
            type="text"
            placeholder="Access key ID"
            {...register("s3AccessKeyId")}
          />
          <Input
            width="full"
            type="password"
            placeholder={
              hasStoredKey ? "Stored; enter a new value to replace it" : "Secret access key"
            }
            {...register("s3SecretAccessKey")}
          />
          <Input width="full" type="text" placeholder="S3 bucket name" {...register("s3Bucket")} />
        </VStack>
      ) : (
        <SettingsFieldValue>
          S3 storage configuration is only visible to organization managers
        </SettingsFieldValue>
      )}
    </SettingsField>
  );
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
  const canManageOrganization = hasPermission("organization:manage");
  const isLiteMember = host.isLiteMember();
  // ADR-038: the Primary use setting only exists where the governance
  // surface it routes to is reachable (flag on, which is the default).
  // ADR-038: the flag is asked for the ORGANIZATION and for no project — the
  // page holds none of its own, which `NOT_TARGETED` is what says.
  void NOT_TARGETED;
  const governanceEnabled =
    useUiFlags().flag(FrontendFlags.release_ui_ai_governance_enabled) === true;
  const [defaultValues, setDefaultValues] = useState<OrganizationFormData>({
    name: organization.name,
    s3Endpoint: organization.s3Endpoint ?? "",
    s3AccessKeyId: organization.s3AccessKeyId ?? "",
    s3SecretAccessKey: "",
    s3Bucket: organization.s3Bucket ?? "",
    presenceEnabled: organization.presenceEnabled,
    traceSharingEnabled: organization.traceSharingEnabled,
    supportContact: organization.supportContact ?? "",
    primaryIntent: organization.primaryIntent ?? "",
  });
  const { register, handleSubmit, control } = useForm({
    defaultValues,
  });
  const updateOrganization = projectApi.organization.update.useMutation();
  const apiContext = projectApi.useUtils();
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
          void apiContext.organization.getScopeGraph.invalidate();
          void apiContext.governance.resolveHome.invalidate();
          const dialog = setupDialogAfterIntentChange({
            nextIntent: data.primaryIntent,
            previousIntent,
            project,
          });
          if (dialog === "create-project") setShowCreateProjectDialog(true);
          if (dialog === "set-up-project") setShowLlmOpsSetupDialog(true);
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
    <Box width="full">
      <PageLayout.Header>
        <PageLayout.Heading>Organization settings</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        <Text textStyle="body" color="fg.muted">
          How your organization is named, where members land, and what they can share.
        </Text>
        <form
          id="organization-settings-form"
          onSubmit={handleSubmit(onSubmit)}
          style={{ width: "100%" }}
        >
          <SettingsSection
            icon={<Building2 size={18} />}
            title="Organization"
            hint="Identity, defaults and collaboration across your projects."
            actions={
              isLiteMember ? undefined : (
                <Button
                  size="sm"
                  type="submit"
                  form="organization-settings-form"
                  colorPalette="accent"
                  loading={updateOrganization.isPending}
                >
                  Save changes
                </Button>
              )
            }
          >
            <SettingsFieldGroup>
              <OrganizationIdentityFields
                canManage={canManageOrganization}
                control={control}
                organization={organization}
                project={project}
                register={register}
              />

              {governanceEnabled && (
                <SettingsField
                  label="Primary use"
                  hint={
                    <>
                      Decides where everyone lands when opening the app; &quot;Not set&quot; keeps
                      the current behaviour.
                      {!canManageOrganization && <AdminOnlyBadge />}
                    </>
                  }
                >
                  {canManageOrganization ? (
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
                    <SettingsFieldValue>
                      {primaryUseCollection.items.find(
                        (item) => item.value === (organization.primaryIntent ?? ""),
                      )?.label ?? <EmptyValue label="Not set" />}
                    </SettingsFieldValue>
                  )}
                </SettingsField>
              )}

              <SettingsField
                label="Live presence"
                controlAlign="end"
                hint={
                  <>
                    Show teammates&apos; avatars, cursors and views; turning it off applies to every
                    project.
                    {!canManageOrganization && <AdminOnlyBadge />}
                  </>
                }
              >
                <Controller
                  control={control}
                  name="presenceEnabled"
                  render={({ field }) => (
                    <Switch
                      colorPalette="accent"
                      checked={field.value}
                      onCheckedChange={({ checked }) => field.onChange(checked)}
                      disabled={!canManageOrganization}
                    />
                  )}
                />
              </SettingsField>

              <SettingsField
                label="Trace sharing"
                controlAlign="end"
                hint={
                  <>
                    Let members share traces by link; turning it off revokes every existing link.
                    {!canManageOrganization && <AdminOnlyBadge />}
                  </>
                }
              >
                <Controller
                  control={control}
                  name="traceSharingEnabled"
                  render={({ field }) => (
                    <Switch
                      colorPalette="accent"
                      checked={field.value}
                      onCheckedChange={({ checked }) => field.onChange(checked)}
                      disabled={!canManageOrganization}
                    />
                  )}
                />
              </SettingsField>

              {organization.useCustomS3 && (
                <S3StorageField
                  canManage={canManageOrganization}
                  hasStoredKey={Boolean(defaultValues.s3AccessKeyId)}
                  register={register}
                />
              )}
            </SettingsFieldGroup>
          </SettingsSection>
        </form>

        {project && hasPermission("project:update") && <ProjectSettingsForm project={project} />}
      </VStack>

      {/* ADR-038 v6: governance -> LLMOps flip on a project-less org — the
        user must know a project is required before the drawer opens */}
      <Dialog.Root
        open={showCreateProjectDialog}
        onOpenChange={({ open }) => setShowCreateProjectDialog(open)}
      >
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title>A project is needed</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              Your changes are saved. Monitoring LLM apps happens inside a project, and this
              organization doesn&apos;t have one yet, create your first project so everyone has
              somewhere to land.
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button variant="outline" onClick={() => setShowCreateProjectDialog(false)}>
                Later
              </Button>
              <Button
                colorPalette="accent"
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
        <Dialog.Content>
          <Dialog.CloseTrigger />
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
                colorPalette="accent"
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
    </Box>
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
  const governanceEnabled =
    useUiFlags().flag(FrontendFlags.release_ui_ai_governance_enabled) === true;
  const organization = host.organization();
  const hasPermission = (permission: string) => host.hasPermission(permission);
  const userIsAdmin = hasPermission("project:manage");

  const defaultValues = {
    name: project.name,
    language: project.language,
    framework: project.framework,
    userLinkTemplate: project.userLinkTemplate ?? "",
    s3Endpoint: project.s3Endpoint ?? "",
    s3AccessKeyId: project.s3AccessKeyId ?? "",
    s3SecretAccessKey: "",
    s3Bucket: project.s3Bucket ?? "",
    traceSharingEnabled: project.traceSharingEnabled,
    presenceEnabled: project.presenceEnabled,
  };
  const [previousValues, setPreviousValues] = useState<ProjectFormData>(defaultValues);
  const form = useForm({
    defaultValues,
  });
  const { register, handleSubmit, control, formState } = form;
  // The React Compiler memoises `form.watch()` on the stable form; useWatch subscribes.
  const language = useWatch({ control, name: "language" });
  const framework = useWatch({ control, name: "framework" });
  const updateProject = projectApi.project.update.useMutation();
  const apiContext = projectApi.useUtils();
  const [changeLanguageFramework, setChangeLanguageFramework] = useState(false);
  const [pendingSharingOff, setPendingSharingOff] = useState<{
    data: ProjectFormData;
    linkCount: number;
  } | null>(null);

  const handleTraceSharingChange = (newValue: boolean) => {
    form.setValue("traceSharingEnabled", newValue);
  };

  const onSubmit: SubmitHandler<ProjectFormData> = async (data: ProjectFormData) => {
    if (isEqual(data, previousValues)) return;

    if (data.traceSharingEnabled === false && project.traceSharingEnabled === true && userIsAdmin) {
      const linkCount = await apiContext.share.countTraceShares.fetch({ projectId: project.id });
      if (linkCount > 0) {
        setPendingSharingOff({ data, linkCount });
        return;
      }
    }

    saveProject({ data, revokeExistingLinks: true });
  };

  const saveProject = ({
    data,
    revokeExistingLinks,
  }: {
    data: ProjectFormData;
    revokeExistingLinks: boolean;
  }) => {
    setPendingSharingOff(null);
    setPreviousValues(data);

    updateProject.mutate(
      {
        projectId: project.id,
        ...data,
        revokeExistingLinks,
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
          void apiContext.organization.getScopeGraph.invalidate();
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
      <HStack width="full" paddingTop={2}>
        <SectionTitle>Project settings</SectionTitle>
        <Spacer />
        {host.projectSwitcher()}
      </HStack>
      <form id="project-settings-form" onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <SettingsSection
          icon={<FolderCog size={18} />}
          title="Project configuration"
          actions={
            <Button
              size="sm"
              type="submit"
              form="project-settings-form"
              colorPalette="accent"
              loading={updateProject.isPending}
            >
              Save changes
            </Button>
          }
        >
          <SettingsFieldGroup>
            <SettingsField
              label="Name"
              hint="The name of the project."
              error={formState.errors.name ? "Name is required" : undefined}
            >
              <Input
                width="full"
                type="text"
                {...register("name", {
                  required: true,
                  validate: (value) => value.trim().length > 0,
                })}
              />
            </SettingsField>
            <ProjectDepartmentField
              organizationId={organization?.id ?? ""}
              projectId={project.id}
              governanceEnabled={governanceEnabled}
            />
            <SettingsField
              label="Tech stack"
              hint="The project's language and framework."
              error={
                formState.errors.language || formState.errors.framework
                  ? "Choose a language and framework"
                  : undefined
              }
            >
              {changeLanguageFramework ? (
                <TechStackSelector form={form} language={language} framework={framework} />
              ) : (
                <HStack>
                  <ProjectTechStackIcon project={project} />
                  <Text textStyle="bodySm">
                    {project.language} · {project.framework}
                  </Text>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setChangeLanguageFramework(true)}
                  >
                    Change
                  </Button>
                </HStack>
              )}
            </SettingsField>
            <SettingsField
              label="Live presence"
              controlAlign="end"
              hint={
                <>
                  {organization?.presenceEnabled === false
                    ? "Turned off for the organization; turn it on there first."
                    : "Show teammates' avatars, cursors and views in this project only."}
                  {!userIsAdmin && <AdminOnlyBadge />}
                </>
              }
            >
              <Controller
                control={control}
                name="presenceEnabled"
                render={({ field }) => (
                  <Switch
                    colorPalette="accent"
                    checked={field.value && (organization?.presenceEnabled ?? true)}
                    onCheckedChange={({ checked }) => field.onChange(checked)}
                    disabled={!userIsAdmin || !(organization?.presenceEnabled ?? true)}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              label="Trace sharing"
              controlAlign="end"
              hint={
                <>
                  {organization?.traceSharingEnabled === false
                    ? "Turned off for the organization; turn it on there first."
                    : "Let members share traces by public link, in this project only."}
                  {!userIsAdmin && <AdminOnlyBadge />}
                </>
              }
            >
              <Controller
                control={control}
                name="traceSharingEnabled"
                render={({ field }) => (
                  <Switch
                    colorPalette="accent"
                    checked={field.value && (organization?.traceSharingEnabled ?? true)}
                    onCheckedChange={({ checked }) => handleTraceSharingChange(checked)}
                    disabled={!userIsAdmin || !(organization?.traceSharingEnabled ?? true)}
                  />
                )}
              />
            </SettingsField>
            {organization?.useCustomS3 && (
              <ProjectS3Fields
                register={register}
                hasStoredAccessKey={!!defaultValues.s3AccessKeyId}
              />
            )}
          </SettingsFieldGroup>
        </SettingsSection>
      </form>

      <TurnOffSharingDialog
        pending={pendingSharingOff}
        onClose={() => setPendingSharingOff(null)}
        onChoose={({ data, revokeExistingLinks }) => saveProject({ data, revokeExistingLinks })}
      />
    </>
  );
}

function ProjectS3Fields({
  register,
  hasStoredAccessKey,
}: {
  register: UseFormRegister<ProjectFormData>;
  hasStoredAccessKey: boolean;
}) {
  return (
    <SettingsField
      label="S3 storage"
      hint="Store this project's datasets in your own S3; empty uses the organization's storage."
    >
      <VStack width="full" align="start" gap={3}>
        <Input width="full" type="text" placeholder="S3 endpoint" {...register("s3Endpoint")} />
        <Input
          width="full"
          type="text"
          placeholder="Access key ID"
          {...register("s3AccessKeyId")}
        />
        <Input
          width="full"
          type="password"
          placeholder={
            hasStoredAccessKey ? "Stored; enter a new value to replace it" : "Secret access key"
          }
          {...register("s3SecretAccessKey")}
        />
        <Input width="full" type="text" placeholder="S3 bucket name" {...register("s3Bucket")} />
      </VStack>
    </SettingsField>
  );
}

function TurnOffSharingDialog({
  pending,
  onClose,
  onChoose,
}: {
  pending: { data: ProjectFormData; linkCount: number } | null;
  onClose: () => void;
  onChoose: (choice: { data: ProjectFormData; revokeExistingLinks: boolean }) => void;
}) {
  const choose = (revokeExistingLinks: boolean) => {
    if (pending) onChoose({ data: pending.data, revokeExistingLinks });
  };

  return (
    <Dialog.Root
      open={pending !== null}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Turn off sharing</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={2}>
            <Text>{pending?.linkCount} share links exist for this project.</Text>
            <Text textStyle="bodySm" color="fg.muted">
              Paused links stop working while sharing is off and work again when you turn it back
              on. Revoked links are gone for good.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={() => choose(false)}>
              Keep links paused
            </Button>
            <Button colorPalette="red" onClick={() => choose(true)}>
              Revoke {pending?.linkCount} links
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
