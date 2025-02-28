import {
  Box,
  Button,
  Card,
  Field,
  HStack,
  Heading,
  Icon,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Select as MultiSelect } from "chakra-react-select";
import { ChevronRight, HelpCircle, Plus, Trash } from "react-feather";
import {
  Controller,
  useFieldArray,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";
import { Link } from "../../components/ui/link";
import { Tooltip } from "../../components/ui/tooltip";
import { TeamProjectsList } from "../../pages/settings/projects";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { HorizontalFormControl } from "../HorizontalFormControl";
import {
  TeamRoleSelect,
  teamRolesOptions,
  type TeamUserRoleForm,
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
  form: UseFormReturn<TeamFormData, any, undefined>;
  onSubmit: SubmitHandler<TeamFormData>;
  isLoading: boolean;
}) => {
  const { register, control, handleSubmit, getFieldState } = form;
  const members = useFieldArray({
    control,
    name: "members",
  });

  const users = api.organization.getAllOrganizationMembers.useQuery({
    organizationId: organizationId,
  });

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack gap="8px">
          <Link href="/settings/teams">Teams</Link>
          <Icon>
            <ChevronRight width="12" />
          </Icon>
          <Text>{team ? team.name : "New Team"}</Text>
        </HStack>
        <HStack width="full">
          <Heading size="lg" as="h1">
            {team ? "Team Settings" : "Create New Team"}
          </Heading>
          <Spacer />
          {isLoading && team && <Spinner />}
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={2}>
            <VStack gap={0}>
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
          </Card.Body>
        </Card.Root>
        <HStack width="full" marginTop={2}>
          <Heading size="md" as="h2">
            Members
          </Heading>
          <Spacer />
          {team && (
            <Link href={`/settings/members`} asChild>
              <Button size="sm" colorPalette="orange">
                <Text>Manage organization members</Text>
              </Button>
            </Link>
          )}
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="48%">Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Role</Table.ColumnHeader>
                  {!team && <Table.ColumnHeader />}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {members.fields.map((member, index) => (
                  <Table.Row key={index}>
                    <Table.Cell>
                      <HStack width="full">
                        {member.saved ? (
                          <>
                            <Text>{member.userId?.label}</Text>
                          </>
                        ) : (
                          <>
                            <Controller
                              control={control}
                              name={`members.${index}.userId`}
                              rules={{ required: "User is required" }}
                              render={({ field }) => (
                                <MultiSelect
                                  {...field}
                                  options={
                                    users.data?.map((user) => ({
                                      label: `${user.name} (${user.email})`,
                                      value: user.id,
                                    })) ?? []
                                  }
                                  hideSelectedOptions={false}
                                  chakraStyles={{
                                    container: (base) => ({
                                      ...base,
                                      background: "white",
                                      width: "100%",
                                      borderRadius: "5px",
                                    }),
                                  }}
                                />
                              )}
                            />
                            <Tooltip
                              content={
                                <>
                                  <Text>
                                    Those are existing members of your
                                    organization.
                                  </Text>
                                  <Text paddingTop={2}>
                                    Want to add a team member that is not listed
                                    yet? You can create the team first and
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
                        )}
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Controller
                        control={control}
                        name={`members.${index}.role`}
                        rules={{ required: "User role is required" }}
                        render={({ field }) => <TeamRoleSelect field={field} />}
                      />
                    </Table.Cell>
                    <Table.Cell paddingLeft={0} paddingRight={0} paddingY={2}>
                      <Button
                        type="button"
                        colorPalette="red"
                        disabled={members.fields.length === 1}
                        onClick={() => members.remove(index)}
                      >
                        <Trash size={18} />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
                <Table.Row>
                  <Table.Cell colSpan={4}>
                    <Button
                      type="button"
                      onClick={() => {
                        members.append({
                          userId: undefined,
                          role: teamRolesOptions[TeamUserRole.MEMBER],
                          saved: false,
                        });
                      }}
                      marginTop={2}
                    >
                      <Plus size={18} /> Add Another
                    </Button>
                  </Table.Cell>
                </Table.Row>
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
            <HStack width="full" marginTop={2}>
              <Heading size="md" as="h2">
                Projects
              </Heading>
              <Spacer />
              <Link href={`/onboarding/${team.slug}/project`} asChild>
                <Button size="sm" colorPalette="orange">
                  <Plus size={20} />
                  <Text>Add new project</Text>
                </Button>
              </Link>
            </HStack>
            <Card.Root width="full">
              <Card.Body width="full" paddingY={0} paddingX={0}>
                <Table.Root variant="line" width="full">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{team.name}</Table.ColumnHeader>
                      <Table.Cell textAlign="right"></Table.Cell>
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
