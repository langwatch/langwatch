import {
  VStack,
  BreadcrumbItem,
  BreadcrumbLink,
  HStack,
  Spacer,
  Spinner,
  Card,
  CardBody,
  Input,
  FormErrorMessage,
  Thead,
  Tr,
  Th,
  Tbody,
  LinkBox,
  Td,
  Breadcrumb,
  Heading,
  Text,
  Table,
  Button,
  Tooltip,
} from "@chakra-ui/react";
import { ChevronRight, HelpCircle, Trash } from "react-feather";
import { HorizontalFormControl } from "../HorizontalFormControl";
import type { TeamWithMembersAndProjects } from "../../server/api/routers/organization";
import NextLink from "next/link";
import {
  useFieldArray,
  type SubmitHandler,
  type UseFormReturn,
  Controller,
} from "react-hook-form";
import {
  TeamRoleSelect,
  TeamUserRoleField,
  teamRolesOptions,
  type TeamUserRoleForm,
} from "./TeamUserRoleField";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { TeamUserRole } from "@prisma/client";
import { api } from "../../utils/api";

export type TeamFormData = {
  name: string;
  members: {
    userId?: { label: string; value: string };
    role: TeamUserRoleForm["role"];
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
  team?: TeamWithMembersAndProjects;
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
            <NextLink href={`/settings/members`}>
              <Button as="a" size="sm" colorScheme="orange">
                <HStack spacing={2}>
                  <Text>Manage organization members</Text>
                </HStack>
              </Button>
            </NextLink>
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
                {team ? (
                  team.members.map((member) => (
                    <LinkBox as="tr" key={team.id}>
                      <Td>{member.user.name}</Td>
                      <Td>
                        <TeamUserRoleField member={member} />
                      </Td>
                    </LinkBox>
                  ))
                ) : (
                  <>
                    {members.fields.map((member, index) => (
                      <Tr key={index}>
                        <Td>
                          <HStack width="full">
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
                                  components={{
                                    SelectContainer: ({
                                      children,
                                      ...props
                                    }) => (
                                      <chakraComponents.SelectContainer
                                        {...props}
                                        innerProps={{
                                          ...props.innerProps,
                                          style: { width: "100%" },
                                        }}
                                      >
                                        {children}
                                      </chakraComponents.SelectContainer>
                                    ),
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
                          </HStack>
                        </Td>
                        <Td>
                          <Controller
                            control={control}
                            name={`members.${index}.role`}
                            rules={{ required: "User role is required" }}
                            render={({ field }) => (
                              <TeamRoleSelect field={field} />
                            )}
                          />
                        </Td>
                        <Td paddingLeft={0} paddingRight={0} paddingY={2}>
                          <Button
                            type="button"
                            colorScheme="red"
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
                            });
                          }}
                          marginTop={2}
                        >
                          + Add Another
                        </Button>
                      </Td>
                    </Tr>
                  </>
                )}
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
      </VStack>
    </form>
  );
};
