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
import { Tooltip } from "@langwatch/design-system/tooltip";
import { FrontendFlags, NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { ProjectDepartmentField } from "@langwatch/organization-client/lent";
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
} from "react-hook-form";

import { projectApi } from "../../../behavior/project-api.ts";
import type { OrganizationIntent } from "../../../model/prisma-types.ts";
import {
  useProjectHost,
  type ProjectHostOrganization,
  type ProjectHostProject,
} from "../../../model/project-host.ts";
import { SaveOnChangeSwitch, type SaveOutcome } from "../../blocks/save-on-change-switch.tsx";

type OrganizationFormData = {
  name: string;
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
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
  register,
}: {
  canManage: boolean;
  control: Control<OrganizationFormData>;
  organization: ProjectHostOrganization;
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

/** Settings › Project › General: the project's own name, id and switches. */
export function ProjectGeneralScreen() {
  const host = useProjectHost();
  const project = host.project();
  const sharedProject = project && !project.isPersonal ? project : undefined;

  return (
    <Box width="full">
      <PageLayout.Header>
        <PageLayout.Heading>Project settings</PageLayout.Heading>
        <Spacer />
        {host.projectSwitcher()}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        {sharedProject && host.hasPermission("project:update") ? (
          <ProjectSettingsForm project={sharedProject} />
        ) : null}
      </VStack>
    </Box>
  );
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
        presenceEnabled: organization.presenceEnabled,
        traceSharingEnabled: organization.traceSharingEnabled,
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

  const saveOrganizationSwitch = ({
    onSuccess,
    onError,
    ...flag
  }: {
    presenceEnabled?: boolean;
    traceSharingEnabled?: boolean;
    onSuccess: () => void;
    onError: (message: string) => void;
  }) =>
    updateOrganization.mutate(
      {
        organizationId: organization.id,
        name: organization.name,
        s3Endpoint: organization.s3Endpoint ?? "",
        s3AccessKeyId: organization.s3AccessKeyId ?? "",
        s3SecretAccessKey: "",
        s3Bucket: organization.s3Bucket ?? "",
        presenceEnabled: organization.presenceEnabled,
        traceSharingEnabled: organization.traceSharingEnabled,
        supportContact: organization.supportContact ?? null,
        primaryIntent: organization.primaryIntent ?? null,
        ...flag,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          void apiContext.organization.getScopeGraph.invalidate();
          onSuccess();
        },
        onError: () => onError("Couldn't save. Try again."),
      },
    );

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
            footer={
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
                <SaveOnChangeSwitch
                  label="Live presence"
                  checked={organization.presenceEnabled}
                  disabled={!canManageOrganization}
                  onSave={({ checked, onSuccess, onError }) =>
                    saveOrganizationSwitch({ presenceEnabled: checked, onSuccess, onError })
                  }
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
                <SaveOnChangeSwitch
                  label="Trace sharing"
                  checked={organization.traceSharingEnabled}
                  disabled={!canManageOrganization}
                  onSave={({ checked, onSuccess, onError }) =>
                    saveOrganizationSwitch({ traceSharingEnabled: checked, onSuccess, onError })
                  }
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
      </VStack>

      {/* ADR-038 v6: governance -> LLMOps flip on a project-less org — the
        user must know a project is required before the drawer opens */}
      <Dialog
        open={showCreateProjectDialog}
        onClose={() => setShowCreateProjectDialog(false)}
        title="A project is needed"
        secondaryAction={{ label: "Later", onClick: () => setShowCreateProjectDialog(false) }}
        primaryAction={{
          label: "Set up project",
          onClick: () => {
            setShowCreateProjectDialog(false);
            host.openOverlay("createProject", {
              navigateOnCreate: true,
              organizationId: organization.id,
              defaultTeamId: organization.teams.find((t) => !t.isPersonal)?.id,
            });
          },
        }}
      >
        <Text>
          Your changes are saved. Monitoring LLM apps happens inside a project, and this
          organization doesn&apos;t have one yet, create your first project so everyone has
          somewhere to land.
        </Text>
      </Dialog>

      {/* ADR-038 F9: governance -> LLMOps flip offers the project setup */}
      <Dialog
        open={showLlmOpsSetupDialog && !!project}
        onClose={() => setShowLlmOpsSetupDialog(false)}
        title="Set up your project"
        secondaryAction={{ label: "Later", onClick: () => setShowLlmOpsSetupDialog(false) }}
        primaryAction={{
          label: "Set up the project",
          onClick: () => {
            // Dialog only opens when a project exists (see open guard).
            window.location.href = `/onboarding/product?projectSlug=${project?.slug ?? ""}`;
          },
        }}
      >
        <Text>
          Everyone in this organization will now land on the project home, but the project
          hasn&apos;t received any data yet. Walk through the project setup so there&apos;s
          something to see when they arrive.
        </Text>
      </Dialog>
    </Box>
  );
}

type ProjectFormData = {
  name: string;
  userLinkTemplate?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
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
    userLinkTemplate: project.userLinkTemplate ?? "",
    s3Endpoint: project.s3Endpoint ?? "",
    s3AccessKeyId: project.s3AccessKeyId ?? "",
    s3SecretAccessKey: "",
    s3Bucket: project.s3Bucket ?? "",
  };
  const [previousValues, setPreviousValues] = useState<ProjectFormData>(defaultValues);
  const form = useForm({
    defaultValues,
  });
  const { register, handleSubmit, formState } = form;
  const updateProject = projectApi.project.update.useMutation();
  const apiContext = projectApi.useUtils();
  const [pendingSharingOff, setPendingSharingOff] = useState<{
    linkCount: number;
    outcome: SaveOutcome;
  } | null>(null);

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (isEqual(data, previousValues)) return;
    setPreviousValues(data);

    updateProject.mutate(
      {
        projectId: project.id,
        ...data,
        // No longer edited here; the update still carries the stored values.
        language: project.language,
        framework: project.framework,
        userLinkTemplate: data.userLinkTemplate ?? "",
        s3Endpoint: data.s3Endpoint ?? "",
        s3AccessKeyId: data.s3AccessKeyId ?? "",
        s3SecretAccessKey: data.s3SecretAccessKey ?? "",
        s3Bucket: data.s3Bucket ?? "",
        presenceEnabled: project.presenceEnabled,
        traceSharingEnabled: project.traceSharingEnabled,
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

  const saveProjectSwitch = ({
    onSuccess,
    onError,
    ...change
  }: {
    presenceEnabled?: boolean;
    traceSharingEnabled?: boolean;
    revokeExistingLinks?: boolean;
  } & SaveOutcome) => {
    setPendingSharingOff(null);
    updateProject.mutate(
      {
        projectId: project.id,
        name: project.name,
        language: project.language,
        framework: project.framework,
        userLinkTemplate: project.userLinkTemplate ?? "",
        s3Endpoint: project.s3Endpoint ?? "",
        s3AccessKeyId: project.s3AccessKeyId ?? "",
        s3SecretAccessKey: "",
        s3Bucket: project.s3Bucket ?? "",
        presenceEnabled: project.presenceEnabled,
        traceSharingEnabled: project.traceSharingEnabled,
        ...change,
      },
      {
        onSuccess: () => {
          void apiContext.organization.getAll.refetch();
          void apiContext.organization.getScopeGraph.invalidate();
          onSuccess();
        },
        onError: () => onError("Couldn't save. Try again."),
      },
    );
  };

  const saveTraceSharing = async ({
    checked,
    onSuccess,
    onError,
  }: { checked: boolean } & SaveOutcome) => {
    if (!checked && userIsAdmin) {
      const linkCount = await apiContext.share.countTraceShares.fetch({ projectId: project.id });
      if (linkCount > 0) {
        setPendingSharingOff({ linkCount, outcome: { onSuccess, onError } });
        return;
      }
    }
    saveProjectSwitch({
      traceSharingEnabled: checked,
      revokeExistingLinks: true,
      onSuccess,
      onError,
    });
  };

  return (
    <>
      <form id="project-settings-form" onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <SettingsSection
          icon={<FolderCog size={18} />}
          title="Project configuration"
          footer={
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
            <SettingsField label="Project ID" hint="Use this ID when authenticating with API keys.">
              <SettingsFieldValue>
                <IdText value={project.id} label="project ID" />
              </SettingsFieldValue>
            </SettingsField>
            <ProjectDepartmentField
              organizationId={organization?.id ?? ""}
              projectId={project.id}
              governanceEnabled={governanceEnabled}
            />
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
              <SaveOnChangeSwitch
                label="Live presence"
                checked={project.presenceEnabled && (organization?.presenceEnabled ?? true)}
                disabled={!userIsAdmin || !(organization?.presenceEnabled ?? true)}
                onSave={({ checked, onSuccess, onError }) =>
                  saveProjectSwitch({ presenceEnabled: checked, onSuccess, onError })
                }
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
              <SaveOnChangeSwitch
                label="Trace sharing"
                checked={project.traceSharingEnabled && (organization?.traceSharingEnabled ?? true)}
                disabled={!userIsAdmin || !(organization?.traceSharingEnabled ?? true)}
                onSave={saveTraceSharing}
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
        onClose={() => {
          pendingSharingOff?.outcome.onError("");
          setPendingSharingOff(null);
        }}
        onChoose={({ outcome, revokeExistingLinks }) =>
          saveProjectSwitch({ traceSharingEnabled: false, revokeExistingLinks, ...outcome })
        }
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
  pending: { linkCount: number; outcome: SaveOutcome } | null;
  onClose: () => void;
  onChoose: (choice: { outcome: SaveOutcome; revokeExistingLinks: boolean }) => void;
}) {
  const choose = (revokeExistingLinks: boolean) => {
    if (pending) onChoose({ outcome: pending.outcome, revokeExistingLinks });
  };

  return (
    <Dialog
      open={pending !== null}
      onClose={onClose}
      title="Turn off sharing"
      secondaryAction={{ label: "Keep links paused", onClick: () => choose(false) }}
      primaryAction={{
        label: `Revoke ${pending?.linkCount} links`,
        danger: true,
        onClick: () => choose(true),
      }}
    >
      <VStack align="start" gap={2}>
        <Text>{pending?.linkCount} share links exist for this project.</Text>
        <Text textStyle="bodySm" color="fg.muted">
          Paused links stop working while sharing is off and work again when you turn it back on.
          Revoked links are gone for good.
        </Text>
      </VStack>
    </Dialog>
  );
}
