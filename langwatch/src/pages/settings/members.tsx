import {
  Alert,
  AlertIcon,
  Button,
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  LinkBox,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
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
  useDisclosure,
} from "@chakra-ui/react";
import type { UserRole } from "@prisma/client";
import { Select as MultiSelect } from "chakra-react-select";
import { Mail, Plus, Trash } from "react-feather";
import {
  Controller,
  useFieldArray,
  useForm,
  type SubmitHandler,
} from "react-hook-form";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useToast } from "@chakra-ui/react";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import { api } from "../../utils/api";

type Option = { label: string; value: string };

type InviteData = {
  email: string;
  teamOptions: Option[];
  role: UserRole;
};

type MembersForm = {
  invites: InviteData[];
};

export default function Members() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        id: organization?.id ?? "",
      },
      { enabled: !!organization }
    );

  if (!organization || !organizationWithMembers.data) return <SettingsLayout />;

  return (
    <MembersList
      teams={organization.teams}
      organization={organizationWithMembers.data}
    />
  );
}

function MembersList({
  organization,
  teams,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: TeamWithProjects[];
}) {
  const teamOptions = teams.map((team) => ({
    label: team.name,
    value: team.id,
  }));

  const {
    isOpen: isAddMembersOpen,
    onOpen: onAddMembersOpen,
    onClose: onAddMembersClose,
  } = useDisclosure();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<MembersForm>({
    defaultValues: {
      invites: [{ email: "", teamOptions: teamOptions, role: "MEMBER" }],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "invites",
  });
  const pendingInvites =
    api.organization.getOrganizationPendingInvites.useQuery(
      {
        id: organization?.id ?? "",
      },
      { enabled: !!organization }
    );
  const createInvitesMutation = api.organization.createInvites.useMutation();
  const toast = useToast();

  const onSubmit: SubmitHandler<MembersForm> = (data) => {
    createInvitesMutation.mutate(
      {
        organizationId: organization.id,
        invites: data.invites.map((invite) => ({
          ...invite,
          teamIds: invite.teamOptions
            .map((teamOption) => teamOption.value)
            .join(","),
        })),
      },
      {
        onSuccess: () => {
          toast({
            title: "Invites sent successfully",
            description: "All invites have been sent.",
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          onAddMembersClose();
          resetForm();
          void pendingInvites.refetch();
        },
        onError: () => {
          toast({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const onAddField = () => {
    append({ email: "", teamOptions, role: "MEMBER" });
  };

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
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Organization Members
          </Heading>
          <Spacer />
          <Button
            size="sm"
            colorScheme="orange"
            onClick={() => onAddMembersOpen()}
          >
            <HStack spacing={2}>
              <Plus size={20} />
              <Text>Add members</Text>
            </HStack>
          </Button>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Teams</Th>
                </Tr>
              </Thead>
              <Tbody>
                {organization.members.map((member) => (
                  <LinkBox as="tr" key={member.userId}>
                    <Td>{member.user.name}</Td>
                    <Td>{member.user.email}</Td>
                    <Td>{member.role}</Td>
                    <Td>
                      {member.user.teamMemberships
                        .flatMap((tmember) => tmember.team)
                        .filter(
                          (tmember) => tmember.organizationId == organization.id
                        )
                        .map((tmember) => tmember.name)
                        .join(", ")}
                    </Td>
                  </LinkBox>
                ))}
              </Tbody>
            </Table>

            {pendingInvites.data && pendingInvites.data.length > 0 && (
              <>
                <Heading size="sm" as="h2" paddingY={4} marginLeft={6}>
                  Pending Invites
                </Heading>

                <Table>
                  <Thead>
                    <Tr>
                      <Th>Email</Th>
                      <Th>Role</Th>
                      <Th>Teams</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {pendingInvites.data?.map((invite) => (
                      <Tr key={invite.id}>
                        <Td>{invite.email}</Td>
                        <Td>{invite.role}</Td>
                        <Td>
                          {invite.teamIds
                            .split(",")
                            .map(
                              (teamId) =>
                                teams.find((team) => team.id == teamId)?.name
                            )
                            .join(", ")}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </>
            )}
          </CardBody>
        </Card>
      </VStack>

      <Modal isOpen={isAddMembersOpen} onClose={onAddMembersClose}>
        <ModalOverlay />
        <ModalContent width="100%" maxWidth="1024px">
          <ModalHeader>Add members</ModalHeader>
          <ModalCloseButton />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit(onSubmit)(e);
            }}
          >
            <ModalBody>
              <Table variant="simple" width="100%">
                <Thead>
                  <Tr>
                    <Th paddingLeft={0} paddingTop={0}>
                      Email
                    </Th>
                    <Th paddingLeft={0} paddingTop={0}>
                      Role
                    </Th>
                    <Th paddingLeft={0} paddingTop={0}>
                      Teams
                    </Th>
                    <Th paddingLeft={0} paddingRight={0} paddingTop={0}></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {fields.map((field, index) => (
                    <Tr key={field.id}>
                      <Td paddingLeft={0} paddingY={2}>
                        <Input
                          placeholder="Enter email address"
                          {...register(`invites.${index}.email`, {
                            required: "Email is required",
                          })}
                        />
                        <FormErrorMessage>
                          {errors.invites?.[index]?.email &&
                            "Email is required"}
                        </FormErrorMessage>
                      </Td>
                      <Td width="20%" paddingLeft={0} paddingY={2}>
                        <Select
                          {...register(`invites.${index}.role`, {
                            required: "Role is required",
                          })}
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="MEMBER">Member</option>
                        </Select>
                        <FormErrorMessage>
                          {errors.invites?.[index]?.role && "Role is required"}
                        </FormErrorMessage>
                      </Td>
                      <Td width="35%" paddingLeft={0} paddingY={2}>
                        <Controller
                          control={control}
                          name={`invites.${index}.teamOptions`}
                          rules={{ required: "At least one team is required" }}
                          render={({ field }) => (
                            <MultiSelect
                              {...field}
                              options={teamOptions}
                              isMulti
                              closeMenuOnSelect={false}
                              selectedOptionStyle="check"
                              hideSelectedOptions={false}
                              useBasicStyles
                              variant="unstyled"
                            />
                          )}
                        />
                      </Td>
                      <Td paddingLeft={0} paddingRight={0} paddingY={2}>
                        <Button
                          type="button"
                          colorScheme="red"
                          onClick={() => remove(index)}
                        >
                          <Trash size={18} />
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <Button type="button" onClick={onAddField} marginTop={2}>
                + Add Another
              </Button>
            </ModalBody>
            <ModalFooter>
              <Button
                colorScheme={
                  createInvitesMutation.isLoading ? "gray" : "orange"
                }
                type="submit"
                disabled={!!createInvitesMutation.isLoading}
              >
                <HStack>
                  {createInvitesMutation.isLoading ? (
                    <Spinner size="sm" />
                  ) : (
                    <Mail size={18} />
                  )}
                  <Text>Send invites</Text>
                </HStack>
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </SettingsLayout>
  );
}
