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
  LinkBox,
  Spacer,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import isEqual from "lodash.isequal";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ChevronRight } from "react-feather";
import {
  useForm,
  useWatch,
  type SubmitHandler,
  Controller,
} from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout from "../../../components/SettingsLayout";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import type {
  TeamMemberWithUser,
  TeamWithMembersAndProjects,
} from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";
import { TeamUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";

type TeamFormData = {
  name: string;
};

export default function Team() {
  const router = useRouter();
  const teamSlug = router.query.team;
  const team = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug as string,
    },
    { enabled: typeof teamSlug === "string" }
  );

  if (!team.data) return <SettingsLayout />;

  return <TeamForm team={team.data} />;
}

function TeamForm({ team }: { team: TeamWithMembersAndProjects }) {
  const [defaultValues, setDefaultValues] = useState<TeamFormData>({
    name: team.name,
  });
  const { register, handleSubmit, control, getFieldState } = useForm({
    defaultValues,
  });
  const formWatch = useWatch({ control });
  const updateTeam = api.team.update.useMutation();
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<TeamFormData> = useDebouncedCallback(
    (data: TeamFormData) => {
      if (isEqual(data, defaultValues)) return;

      setDefaultValues(data);

      updateTeam.mutate(
        {
          id: team.id,
          name: data.name,
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
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
            <BreadcrumbLink>{team.name}</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
        <HStack width="full">
          <Heading size="lg" as="h1">
            Team Settings
          </Heading>
          <Spacer />
          {updateTeam.isLoading && <Spinner />}
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={2}>
            <form onSubmit={void handleSubmit(onSubmit)}>
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
                <HorizontalFormControl
                  label="Slug"
                  helper="The unique ID of your team"
                >
                  <Input width="full" disabled type="text" value={team.slug} />
                </HorizontalFormControl>
              </VStack>
            </form>
          </CardBody>
        </Card>
        <HStack width="full" marginTop={2}>
          <Heading size="md" as="h2">
            Members
          </Heading>
          <Spacer />
          <NextLink href={`/settings/members`}>
            <Button as="a" size="sm" colorScheme="orange">
              <HStack spacing={2}>
                <Text>Manage organization members</Text>
              </HStack>
            </Button>
          </NextLink>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th width="48%">Name</Th>
                  <Th>Role</Th>
                </Tr>
              </Thead>
              <Tbody>
                {team.members.map((member) => (
                  <LinkBox as="tr" key={team.id}>
                    <Td>{member.user.name}</Td>
                    <Td>
                      <TeamUserRoleField member={member} />
                    </Td>
                  </LinkBox>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}

const TeamUserRoleField = ({ member }: { member: TeamMemberWithUser }) => {
  const teamRolesOptions: {
    [K in TeamUserRole]: { label: string; value: K; description: string };
  } = {
    [TeamUserRole.ADMIN]: {
      label: "Admin",
      value: TeamUserRole.ADMIN,
      description: "Can manage team and add or remove members",
    },
    [TeamUserRole.MEMBER]: {
      label: "Member",
      value: TeamUserRole.MEMBER,
      description: "Can setup the project, see costs, add or remove guardrails",
    },
    [TeamUserRole.VIEWER]: {
      label: "Viewer",
      value: TeamUserRole.VIEWER,
      description:
        "Can only view analytics, messages and guardrails results, cannot see costs, debugging data or modify anything",
    },
  };

  type TeamUserRoleForm = {
    role: (typeof teamRolesOptions)[TeamUserRole];
  };

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<TeamUserRoleForm>({
    defaultValues: {
      role: teamRolesOptions[member.role],
    },
  });

  const updateTeamMemberRoleMutation =
    api.organization.updateTeamMemberRole.useMutation();
  const toast = useToast();

  const onSubmit: SubmitHandler<TeamUserRoleForm> = (data) => {
    updateTeamMemberRoleMutation.mutate(
      {
        teamId: member.teamId,
        userId: member.userId,
        role: data.role.value,
      },
      {
        onError: () => {
          toast({
            title: "Failed to update user role",
            description: "Please try that again",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          resetForm();
        },
      }
    );
  };

  return (
    <VStack align="start">
      <Controller
        control={control}
        name={`role`}
        rules={{ required: "User role is required" }}
        render={({ field }) => (
          <HStack spacing={6}>
            <MultiSelect
              {...field}
              options={Object.values(teamRolesOptions)}
              hideSelectedOptions={false}
              isSearchable={false}
              useBasicStyles
              onChange={(value) => {
                field.onChange(value);
                void handleSubmit(onSubmit)();
              }}
              components={{
                Menu: ({ children, ...props }) => (
                  <chakraComponents.Menu
                    {...props}
                    innerProps={{
                      ...props.innerProps,
                      style: { width: "300px" },
                    }}
                  >
                    {children}
                  </chakraComponents.Menu>
                ),
                Option: ({ children, ...props }) => (
                  <chakraComponents.Option {...props}>
                    <VStack align="start">
                      <Text>{children}</Text>
                      <Text
                        color={props.isSelected ? "white" : "gray.500"}
                        fontSize={13}
                      >
                        {props.data.description}
                      </Text>
                    </VStack>
                  </chakraComponents.Option>
                ),
              }}
            />
            {updateTeamMemberRoleMutation.isLoading && <Spinner size="sm" />}
          </HStack>
        )}
      />
      <FormErrorMessage>{errors.role && "Role is required"}</FormErrorMessage>
    </VStack>
  );
};
