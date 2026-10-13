import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Box,
  Button,
  createListCollection,
  Heading,
  HStack,
  Input,
  type ListCollection,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { CreateProjectDrawerToken } from "@langwatch/organization-client";
import { HelpCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type Control,
  Controller,
  type SubmitHandler,
  type UseFormReturn,
  useFieldArray,
  useFormState,
  useWatch,
} from "react-hook-form";

import { api, type RouterOutputs } from "../../behavior/organization-api.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { ProjectAvatar } from "../elements/project-avatar.tsx";

/**
 * One team as this form reads it: whatever `team.getTeamWithMembers` answers.
 * Taken off the seam rather than off the Prisma model, because the procedure
 * serves a browser-shaped team (no accounting columns) plus its projects.
 */
type TeamWithProjectsAndMembers = RouterOutputs["team"]["getTeamWithMembers"];
import { Select } from "@langwatch/design-system/select";
import { SettingsField, SettingsFieldGroup } from "@langwatch/design-system/settings-field";

import { useOrganizationToaster } from "../../behavior/organization-feedback.ts";
import { memberLabel } from "../../model/member-label.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import {
  TeamRoleSelect,
  type TeamUserRoleForm,
  teamRolesOptions,
} from "./team-user-role-field.tsx";

function TeamProjectsBody({
  team,
  onArchiveClick,
}: {
  team: TeamWithProjectsAndMembers;
  onArchiveClick: (project: { id: string; name: string }) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const host = useOrganizationHost();

  const { openDrawer } = useDrawer();

  return (
    <ListTable.Body>
      {team.projects.map((teamProject) => (
        <ListTable.Row key={teamProject.id}>
          <ListTable.Cell>
            <HStack gap={2}>
              <ProjectAvatar name={teamProject.name} />
              <Link href={`/${teamProject.slug}`}>{teamProject.name}</Link>
            </HStack>
          </ListTable.Cell>
          <ListTable.ActionCell>
            {teamProject.id !== project?.id && host.hasPermission("project:delete") && (
              <Button
                variant="ghost"
                color="red.fg"
                size="sm"
                onClick={() =>
                  onArchiveClick({
                    id: teamProject.id,
                    name: teamProject.name,
                  })
                }
              >
                <Trash2 size={16} />
              </Button>
            )}
          </ListTable.ActionCell>
        </ListTable.Row>
      ))}
      {team.projects.length === 0 && (
        <ListTable.SpanRow columns={2}>
          <HStack paddingX={4} paddingY={1}>
            <NoDataInfoBlock
              size="line"
              title="No projects on this team yet."
              action={{
                label: "Add new project",
                onClick: () => openDrawer(CreateProjectDrawerToken, { defaultTeamId: team.id }),
              }}
            />
          </HStack>
        </ListTable.SpanRow>
      )}
    </ListTable.Body>
  );
}

export type TeamFormData = {
  name: string;
  members: {
    userId?: { label: string; value: string };
    role: TeamUserRoleForm["role"];
    saved: boolean;
  }[];
};

type UserOption = { label: string; value: string };

function MemberUserPicker({
  control,
  index,
  perRowCollection,
  userOptions,
}: {
  control: Control<TeamFormData, unknown, TeamFormData>;
  index: number;
  perRowCollection: ListCollection<UserOption> | undefined;
  userOptions: UserOption[];
}) {
  return (
    <>
      <Controller
        control={control}
        name={`members.${index}.userId`}
        rules={{ required: "User is required" }}
        render={({ field }) => {
          const rowCollection = perRowCollection ?? createListCollection({ items: userOptions });
          return (
            <Select.Root
              collection={rowCollection}
              value={field.value ? [field.value.value] : []}
              onValueChange={(details) => {
                const selectedValue = details.value[0];
                if (selectedValue) {
                  const selectedOption = userOptions.find((o) => o.value === selectedValue);
                  if (selectedOption) {
                    field.onChange(selectedOption);
                  }
                }
              }}
            >
              <Select.Trigger width="full" background="bg">
                <Select.ValueText placeholder="Select..." />
              </Select.Trigger>
              <Select.Content paddingY={2}>
                {rowCollection.items.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          );
        }}
      />
      <Tooltip
        content={
          <>
            <Text>Those are existing members of your organization.</Text>
            <Text paddingTop={2}>
              Want to add a team member that is not listed yet? You can create the team first and
              invite them later to the organization
            </Text>
          </>
        }
        positioning={{ placement: "top" }}
        showArrow
      >
        <Box>
          <HelpCircle width="14px" />
        </Box>
      </Tooltip>
    </>
  );
}

export const TeamForm = ({
  organizationId,
  team,
  form,
  onSubmit,
  isLoading,
  formId,
}: {
  organizationId: string;
  team?: TeamWithProjectsAndMembers;
  form: UseFormReturn<TeamFormData, unknown, TeamFormData>;
  onSubmit: SubmitHandler<TeamFormData>;
  isLoading: boolean;
  /** Set when the host draws Create (a drawer footer) and submits this form by id. */
  formId?: string;
}) => {
  const toaster = useOrganizationToaster();
  const { control, handleSubmit } = form;
  // A subscription, so a refused submit re-renders the field as invalid (WEB-5602).
  const { errors } = useFormState({ control, name: "name" });
  const members = useFieldArray({
    control,
    name: "members",
  });

  const host = useOrganizationHost();
  const canManageOrganization = host.hasOrganizationPermission("organization:manage");

  const queryClient = api.useUtils();
  const { project } = useOrganizationTeamProject();
  const [projectToArchive, setProjectToArchive] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const archiveProject = api.project.archiveById.useMutation({
    onSuccess: () => {
      setProjectToArchive(null);
      void queryClient.organization.getAll.invalidate();
      void queryClient.organization.getScopeGraph.invalidate();
      void queryClient.team.getTeamWithMembers.invalidate();
    },
    onError: () => {
      toaster.create({
        title: "Failed to archive project",
        type: "error",
        duration: 5000,
      });
    },
  });

  const users = api.organization.getAllOrganizationMembers.useQuery({
    organizationId: organizationId,
  });

  const userOptions = useMemo(
    () =>
      users.data?.map((user) => ({
        label: memberLabel(user),
        value: user.id,
      })) ?? [],
    [users.data],
  );

  const watchedMembers = useWatch({ control, name: "members" });

  const perRowCollections = useMemo(() => {
    const rows = watchedMembers ?? [];
    return rows.map((_, index) => {
      const selectedIds = new Set(
        rows
          .filter((_, i) => i !== index)
          .map((m) => m.userId?.value)
          .filter(Boolean),
      );
      const filtered = userOptions.filter((o) => !selectedIds.has(o.value));
      return createListCollection({ items: filtered });
    });
  }, [watchedMembers, userOptions]);

  return (
    <form id={formId} style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4} width="full" align="start">
        <SettingsFieldGroup>
          <SettingsField
            label="Name"
            hint="The name of your team."
            error={errors.name ? errors.name.message || "Name is required" : undefined}
          >
            {/* A Controller, not register(): the React Compiler memoises register()
                past form.reset, so typing never reached the form (WEB-5603). */}
            <Controller
              control={control}
              name="name"
              rules={{ required: true, validate: (value) => value.trim().length > 0 }}
              render={({ field }) => (
                <Input width="full" type="text" data-testid="team-form-name" {...field} />
              )}
            />
          </SettingsField>
          {team && (
            <SettingsField label="Slug" hint="The unique ID of your team.">
              <Input width="full" disabled type="text" value={team.slug} />
            </SettingsField>
          )}
        </SettingsFieldGroup>
        <HStack width="full" marginTop={2}>
          <Heading size="sm">Members</Heading>
          <Spacer />
          {team && (
            <Link href={`/settings/members`}>
              <Button variant="outline" size="sm">
                Manage organization members
              </Button>
            </Link>
          )}
        </HStack>
        <Card padding="none">
          <ListTable variant="embedded">
            <ListTable.Header>
              <ListTable.Row>
                <ListTable.ColumnHeader width="48%">Name</ListTable.ColumnHeader>
                <ListTable.ColumnHeader>Team role</ListTable.ColumnHeader>
                <ListTable.ActionHeader />
              </ListTable.Row>
            </ListTable.Header>
            <ListTable.Body>
              {members.fields.map((member, index) => (
                <ListTable.Row key={member.id}>
                  <ListTable.Cell>
                    <HStack width="full">
                      {member.saved ? (
                        <>
                          <Text>{member.userId?.label}</Text>
                        </>
                      ) : (
                        <MemberUserPicker
                          control={control}
                          index={index}
                          perRowCollection={perRowCollections[index]}
                          userOptions={userOptions}
                        />
                      )}
                    </HStack>
                  </ListTable.Cell>
                  <ListTable.Cell>
                    <Controller
                      control={control}
                      name={`members.${index}.role`}
                      rules={{ required: "User role is required" }}
                      render={({ field }) =>
                        canManageOrganization ? (
                          <TeamRoleSelect
                            organizationId={organizationId}
                            organizationRole={OrganizationUserRole.ADMIN}
                            value={field.value}
                            onChange={field.onChange}
                          />
                        ) : (
                          <Text>{field.value?.label ?? "—"}</Text>
                        )
                      }
                    />
                  </ListTable.Cell>
                  <ListTable.ActionCell>
                    {canManageOrganization && (
                      <Button
                        type="button"
                        variant="ghost"
                        color="red.fg"
                        disabled={members.fields.length === 1}
                        onClick={() => members.remove(index)}
                      >
                        <Trash2 size={18} />
                      </Button>
                    )}
                  </ListTable.ActionCell>
                </ListTable.Row>
              ))}
              {canManageOrganization && (
                <ListTable.SpanRow columns={3}>
                  <Box paddingX={4} paddingY={3}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        members.append({
                          userId: undefined,
                          role: teamRolesOptions[TeamUserRole.MEMBER],
                          saved: false,
                        });
                      }}
                    >
                      <Plus size={18} /> Add Another
                    </Button>
                  </Box>
                </ListTable.SpanRow>
              )}
            </ListTable.Body>
          </ListTable>
        </Card>
        {!team && formId === undefined && (
          <HStack width="full">
            <Spacer />
            <Button
              type="submit"
              colorPalette="orange"
              loading={isLoading}
              data-testid="team-form-submit"
            >
              Create
            </Button>
          </HStack>
        )}
        {team && (
          <>
            <TeamFormProjects team={team} />
            <Card padding="none">
              <ListTable variant="embedded">
                <ListTable.Header>
                  <ListTable.Row>
                    <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
                    <ListTable.ActionHeader />
                  </ListTable.Row>
                </ListTable.Header>
                <TeamProjectsBody team={team} onArchiveClick={setProjectToArchive} />
              </ListTable>
            </Card>
            <ConfirmDialog
              open={!!projectToArchive}
              onOpenChange={(open) => {
                if (!open) setProjectToArchive(null);
              }}
              title="Archive Project"
              message={`Are you sure you want to archive "${projectToArchive?.name ?? ""}"? This will hide the project and all its data. Contact LangWatch support to restore it.`}
              confirmLabel="Archive"
              tone="danger"
              loading={archiveProject.isPending}
              onConfirm={() => {
                if (!project || !projectToArchive) return;
                archiveProject.mutate({
                  projectId: project.id,
                  projectToArchiveId: projectToArchive.id,
                });
              }}
            />
          </>
        )}
      </VStack>
    </form>
  );
};

function TeamFormProjects({ team }: { team: TeamWithProjectsAndMembers }): React.ReactElement {
  const { openDrawer } = useDrawer();

  return (
    <HStack width="full" marginTop={2}>
      <Heading size="sm">Projects</Heading>
      <Spacer />
      <Button
        variant="outline"
        size="sm"
        onClick={() => openDrawer(CreateProjectDrawerToken, { defaultTeamId: team.id })}
      >
        <Plus size={20} />
        Add new project
      </Button>
    </HStack>
  );
}
