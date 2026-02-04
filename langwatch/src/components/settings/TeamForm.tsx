import {
  Box,
  Button,
  Card,
  createListCollection,
  Field,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { HelpCircle, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
  Controller,
  type SubmitHandler,
  type UseFormReturn,
  useFieldArray,
} from "react-hook-form";
import { Link } from "../../components/ui/link";
import { Tooltip } from "../../components/ui/tooltip";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamProjectsList } from "../../pages/settings/projects";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Select } from "../ui/select";
import {
  TeamRoleSelect,
  type TeamUserRoleForm,
  teamRolesOptions,
} from "./TeamUserRoleField";

export type TeamFormData = {
  name: string;
  members: {
    userId?: { label: string; value: string };
    role: TeamUserRoleForm["role"];
    saved: boolean;
  }[];
};

export const TeamForm = ({
  organizationId,
  team,
  form,
  onSubmit,
  isLoading,
}: {
  organizationId: string;
  team?: TeamWithProjectsAndMembersAndUsers;
  form: UseFormReturn<TeamFormData, any, TeamFormData>;
  onSubmit: SubmitHandler<TeamFormData>;
  isLoading: boolean;
}) => {
  const { register, control, handleSubmit, getFieldState } = form;
  const members = useFieldArray({
    control,
    name: "members",
  });

  const { hasOrgPermission } = useOrganizationTeamProject();
  const canManageOrganization = hasOrgPermission("organization:manage");

  const users = api.organization.getAllOrganizationMembers.useQuery({
    organizationId: organizationId,
  });

  const userOptions = useMemo(
    () =>
      users.data?.map((user) => ({
        label: `${user.name} (${user.email})`,
        value: user.id,
      })) ?? [],
    [users.data],
  );

  const userCollection = useMemo(
    () => createListCollection({ items: userOptions }),
    [userOptions],
  );

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4} width="full" align="start">
        <HStack width="full">
          <Heading>{team ? "Team Settings" : "Create New Team"}</Heading>
          <Spacer />
          {isLoading && team && <Spinner />}
        </HStack>
        <VStack width="full" gap={0}>
          <HorizontalFormControl
            label="Name"
            helper="The name of your team"
            invalid={!!getFieldState("name").error}
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
          {team && (
            <HorizontalFormControl
              label="Slug"
              helper="The unique ID of your team"
            >
              <Input width="full" disabled type="text" value={team.slug} />
            </HorizontalFormControl>
          )}
        </VStack>
        <HStack width="full" marginTop={2}>
          <Heading>Members</Heading>
          <Spacer />
          {team && (
            <Link href={`/settings/members`} asChild>
              <Button variant="outline" size="sm">
                Manage organization members
              </Button>
            </Link>
          )}
        </HStack>
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="48%">Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Team Role</Table.ColumnHeader>
                  <Table.ColumnHeader width="60px" />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {members.fields.map((member, index) => (
                  <Table.Row key={index}>
                    <Table.Cell>
                      <HStack width="full">
                        {member.saved ? (
                          <>
                            <Link
                              href={`/settings/members/${member.userId?.value}`}
                            >
                              {member.userId?.label}
                            </Link>
                          </>
                        ) : (
                          <>
                            <Controller
                              control={control}
                              name={`members.${index}.userId`}
                              rules={{ required: "User is required" }}
                              render={({ field }) => (
                                <Select.Root
                                  collection={userCollection}
                                  value={field.value ? [field.value.value] : []}
                                  onValueChange={(details) => {
                                    const selectedValue = details.value[0];
                                    if (selectedValue) {
                                      const selectedOption = userOptions.find(
                                        (o) => o.value === selectedValue,
                                      );
                                      if (selectedOption) {
                                        field.onChange(selectedOption);
                                      }
                                    }
                                  }}
                                >
                                  <Select.Trigger width="full" background="bg">
                                    <Select.ValueText placeholder="Select..." />
                                  </Select.Trigger>
                                  <Select.Content paddingY={2} zIndex="popover">
                                    {userOptions.map((option) => (
                                      <Select.Item key={option.value} item={option}>
                                        {option.label}
                                      </Select.Item>
                                    ))}
                                  </Select.Content>
                                </Select.Root>
                              )}
                            />
                            <Tooltip
                              content={
                                <>
                                  <Text>
                                    Those are existing members of your organization.
                                  </Text>
                                  <Text paddingTop={2}>
                                    Want to add a team member that is not listed
                                    yet? You can create the team first and invite
                                    them later to the organization
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
                        )}
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Controller
                        control={control}
                        name={`members.${index}.role`}
                        rules={{ required: "User role is required" }}
                        render={({ field }) =>
                          canManageOrganization ? (
                            <TeamRoleSelect
                              organizationId={organizationId}
                              value={field.value}
                              onChange={field.onChange}
                            />
                          ) : (
                            <Text>{field.value?.label ?? "—"}</Text>
                          )
                        }
                      />
                    </Table.Cell>
                    <Table.Cell paddingLeft={0} paddingY={2}>
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
                    </Table.Cell>
                  </Table.Row>
                ))}
                {canManageOrganization && (
                  <Table.Row>
                    <Table.Cell colSpan={4}>
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
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
        {!team && (
          <HStack width="full">
            <Spacer />
            <Button type="submit" colorPalette="orange" loading={isLoading}>
              Create
            </Button>
          </HStack>
        )}
        {team && (
          <>
            <TeamFormProjects team={team} />
            <Card.Root width="full" overflow="hidden">
              <Card.Body paddingY={0} paddingX={0}>
                <Table.Root variant="line" width="full" size="md">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Name</Table.ColumnHeader>
                      <Table.ColumnHeader width="60px"></Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <TeamProjectsList team={team} />
                </Table.Root>
              </Card.Body>
            </Card.Root>
          </>
        )}
      </VStack>
    </form>
  );
};

function TeamFormProjects({
  team,
}: {
  team: TeamWithProjectsAndMembersAndUsers;
}): React.ReactElement {
  const { openDrawer } = useDrawer();

  return (
    <HStack width="full" marginTop={2}>
      <Heading>Projects</Heading>
      <Spacer />
      <Button
        variant="outline"
        size="sm"
        onClick={() => openDrawer("createProject", { defaultTeamId: team.id })}
      >
        <Plus size={20} />
        Add new project
      </Button>
    </HStack>
  );
}
