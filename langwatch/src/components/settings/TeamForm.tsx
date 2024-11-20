import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Button,
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  Spacer,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Select as MultiSelect } from "chakra-react-select";
import NextLink from "next/link";
import { ChevronRight, HelpCircle, Plus, Trash } from "react-feather";
import {
  Controller,
  useFieldArray,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { HorizontalFormControl } from "../HorizontalFormControl";
import {
  TeamRoleSelect,
  teamRolesOptions,
  type TeamUserRoleForm,
} from "./TeamUserRoleField";
import { TeamProjectsList } from "../../pages/settings/projects";
import React from "react";

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
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <Breadcrumb spacing="8px" separator={<ChevronRight width="12" />}>
          <BreadcrumbItem>
            <BreadcrumbLink as={NextLink} href="/settings/teams">
              Teams
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbItem isCurrentPage>
            <BreadcrumbLink>{team ? team.name : "New Team"}</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <HStack width="full">
          <Heading size="lg" as="h1">
            {team ? "Team Settings" : "Create New Team"}
          </Heading>
          <Spacer />
          {isLoading && team && <Spinner />}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={2}>
            <VStack spacing={0}>
              <HorizontalFormControl
                label="Name"
                helper="The name of your team"
                isInvalid={!!getFieldState("name").error}
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
                <FormErrorMessage>Name is required</FormErrorMessage>
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
          </CardBody>
        </Card>
        <HStack width="full" marginTop={2}>
          <Heading size="md" as="h2">
            Members
          </Heading>
          <Spacer />
          {team && (
            <Button
              as={NextLink}
              href={`/settings/members`}
              size="sm"
              colorScheme="orange"
            >
              <Text>Manage organization members</Text>
            </Button>
          )}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th width="48%">Name</Th>
                  <Th>Role</Th>
                  {!team && <Th />}
                </Tr>
              </Thead>
              <Tbody>
                {members.fields.map((member, index) => (
                  <Tr key={index}>
                    <Td>
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
                                  useBasicStyles
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
                              label={
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
                            >
                              <HelpCircle width="14px" />
                            </Tooltip>
                          </>
                        )}
                      </HStack>
                    </Td>
                    <Td>
                      <Controller
                        control={control}
                        name={`members.${index}.role`}
                        rules={{ required: "User role is required" }}
                        render={({ field }) => <TeamRoleSelect field={field} />}
                      />
                    </Td>
                    <Td paddingLeft={0} paddingRight={0} paddingY={2}>
                      <Button
                        type="button"
                        colorScheme="red"
                        isDisabled={members.fields.length === 1}
                        onClick={() => members.remove(index)}
                      >
                        <Trash size={18} />
                      </Button>
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td colSpan={4}>
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
                      + Add Another
                    </Button>
                  </Td>
                </Tr>
              </Tbody>
            </Table>
          </CardBody>
        </Card>
        {!team && (
          <HStack width="full">
            <Spacer />
            <Button type="submit" colorScheme="orange" isLoading={isLoading}>
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
              <Button
                as={NextLink}
                href={`/onboarding/${team.slug}/project`}
                size="sm"
                colorScheme="orange"
              >
                <HStack spacing={2}>
                  <Plus size={20} />
                  <Text>Add new project</Text>
                </HStack>
              </Button>
            </HStack>
            <Card width="full">
              <CardBody width="full" paddingY={0} paddingX={0}>
                <Table variant="simple" width="full">
                  <Thead>
                    <Tr>
                      <Th>{team.name}</Th>
                      <Td textAlign="right"></Td>
                    </Tr>
                  </Thead>
                  <TeamProjectsList team={team} />
                </Table>
              </CardBody>
            </Card>
          </>
        )}
      </VStack>
    </form>
  );
};
