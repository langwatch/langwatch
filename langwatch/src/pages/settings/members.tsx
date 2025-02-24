import { DeleteIcon } from "@chakra-ui/icons";
import {
  Button,
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  LinkBox,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
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
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { Lock, Mail, MoreVertical, Plus, Trash } from "react-feather";
import { CopyInput } from "../../components/CopyInput";

import {
  Controller,
  useFieldArray,
  useForm,
  type SubmitHandler,
} from "react-hook-form";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import { type PlanInfo } from "../../server/subscriptionHandler";
import { api } from "../../utils/api";
import { useState } from "react";
import { useRouter } from "next/router";

type Option = { label: string; value: string; description?: string };

type InviteData = {
  email: string;
  teamOptions: Option[];
  role?: Option;
};

type MembersForm = {
  invites: InviteData[];
};

export default function Members() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization }
    );
  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    }
  );

  if (!organization || !organizationWithMembers.data || !activePlan.data)
    return <SettingsLayout />;

  return (
    <MembersList
      teams={organization.teams}
      organization={organizationWithMembers.data}
      activePlan={activePlan.data}
    />
  );
}

function MembersList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: TeamWithProjects[];
  activePlan: PlanInfo;
}) {
  const teamOptions = teams.map((team) => ({
    label: team.name,
    value: team.id,
  }));
  const queryClient = api.useContext();

  const {
    isOpen: isAddMembersOpen,
    onOpen: onAddMembersOpen,
    onClose: onAddMembersClose,
  } = useDisclosure();

  const {
    isOpen: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<MembersForm>({
    defaultValues: {
      invites: [{ email: "", teamOptions: teamOptions }],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "invites",
  });
  const pendingInvites =
    api.organization.getOrganizationPendingInvites.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization }
    );
  const createInvitesMutation = api.organization.createInvites.useMutation();
  const deleteMemberMutation = api.organization.deleteMember.useMutation();
  const deleteInviteMutation = api.organization.deleteInvite.useMutation();
  const toast = useToast();
  const router = useRouter();

  const [selectedInvites, setSelectedInvites] = useState<
    { inviteCode: string; email: string }[]
  >([]);

  const onSubmit: SubmitHandler<MembersForm> = (data) => {
    createInvitesMutation.mutate(
      {
        organizationId: organization.id,
        invites: data.invites.map((invite) => ({
          email: invite.email.toLowerCase(),
          role: invite.role!.value as OrganizationUserRole,
          teamIds: invite.teamOptions
            .map((teamOption) => teamOption.value)
            .join(","),
        })),
      },
      {
        onSuccess: (data) => {
          const newInvites = data.reduce(
            (acc, invite) => {
              if (invite?.invite && invite.noEmailProvider) {
                acc.push({
                  inviteCode: invite.invite.id,
                  email: invite.invite.email,
                });
              }
              return acc;
            },
            [] as { inviteCode: string; email: string }[]
          );

          setSelectedInvites(newInvites);

          const title =
            newInvites.length > 0
              ? "Invites created successfully"
              : "Invites sent successfully";

          const description =
            newInvites.length > 0
              ? "All invites have been created."
              : "All invites have been sent.";

          toast({
            title: title,
            description: description,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          onAddMembersClose();
          resetForm();
          void pendingInvites.refetch();
          if (newInvites.length > 0) {
            onInviteLinkOpen();
          }
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
    append({ email: "", teamOptions });
  };

  const deleteMember = (userId: string) => {
    deleteMemberMutation.mutate(
      {
        organizationId: organization.id,
        userId,
      },
      {
        onSuccess: () => {
          toast({
            title: "Member removed successfully",
            description: "The member has been removed from the organization.",
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          // how to refect this organizationWithMembers
          void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
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

  const viewInviteLink = (inviteCode: string, email: string) => {
    setSelectedInvites([{ inviteCode, email }]);
    onInviteLinkOpen();
  };

  const onInviteModalClose = () => {
    setSelectedInvites([]);
    onInviteLinkClose();
  };

  const deleteInvite = (inviteId: string) => {
    deleteInviteMutation.mutate(
      { inviteId, organizationId: organization.id },
      {
        onSuccess: () => {
          toast({
            title: "Invite deleted successfully",
            description: "The invite has been deleted.",
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          void pendingInvites.refetch();
        },
      }
    );
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="980px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Organization Members
          </Heading>
          <Spacer />
          {!activePlan.overrideAddingLimitations &&
          organization.members.length >= activePlan.maxMembers ? (
            <Tooltip content="Upgrade your plan to add more members">
              <Button size="sm" colorPalette="orange" isDisabled={true}>
                <HStack gap={2}>
                  <Lock size={20} />
                  <Text>Add members</Text>
                </HStack>
              </Button>
            </Tooltip>
          ) : (
            <Button
              size="sm"
              colorPalette="orange"
              onClick={() => onAddMembersOpen()}
            >
              <HStack gap={2}>
                <Plus size={20} />
                <Text>Add members</Text>
              </HStack>
            </Button>
          )}
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
                  <Th>Actions</Th>
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
                    <Td>
                      <Menu>
                        <MenuButton
                          as={Button}
                          variant={"ghost"}
                          // isLoading={
                          //   deleteGraphs.isLoading &&
                          //   deleteGraphs.variables?.id === graph.id
                          // }
                        >
                          <MoreVertical />
                        </MenuButton>
                        <MenuList>
                          <MenuItem
                            color="red.600"
                            isDisabled={organization.members.length === 1}
                            onClick={() => deleteMember(member.userId)}
                            icon={<DeleteIcon />}
                          >
                            Remove Member
                          </MenuItem>
                        </MenuList>
                      </Menu>
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
                      <Th>Actions</Th>
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
                        <Td>
                          <Menu>
                            <MenuButton as={Button} variant={"ghost"}>
                              {deleteInviteMutation.isLoading &&
                              invite.id ===
                                deleteInviteMutation.variables?.inviteId ? (
                                <Spinner size="sm" />
                              ) : (
                                <MoreVertical />
                              )}
                            </MenuButton>
                            <MenuList>
                              <MenuItem
                                color="red.600"
                                onClick={() => deleteInvite(invite.id)}
                              >
                                Delete
                              </MenuItem>
                              <MenuItem
                                onClick={() =>
                                  viewInviteLink(
                                    invite.inviteCode,
                                    invite.email
                                  )
                                }
                              >
                                View Invite Link
                              </MenuItem>
                            </MenuList>
                          </Menu>
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

      <Modal isOpen={isInviteLinkOpen} onClose={onInviteModalClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack>
              <Mail />
              <Text>Invite Link</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody paddingBottom={6}>
            <VStack align="start" gap={4}>
              <Text>
                Send the link below to the users you want to invite to join the
                organization.
              </Text>

              <VStack align="start" gap={4} width="full">
                {selectedInvites.map((invite) => (
                  <VStack
                    key={invite.inviteCode}
                    align="start"
                    gap={2}
                    width="full"
                  >
                    <Text fontWeight="600">{invite.email}</Text>
                    <CopyInput
                      value={`${window.location.origin}/invite/accept?inviteCode=${invite.inviteCode}`}
                      label="Invite Link"
                      marginTop={0}
                    />
                  </VStack>
                ))}
              </VStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

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
                      <Td width="24%" paddingLeft={0} paddingY={2}>
                        <Controller
                          control={control}
                          name={`invites.${index}.role`}
                          rules={{ required: "User role is required" }}
                          render={({ field }) => (
                            <MultiSelect
                              {...field}
                              options={[
                                {
                                  label: "Admin",
                                  value: OrganizationUserRole.ADMIN,
                                  description:
                                    "Can manage organization and add or remove members",
                                },
                                {
                                  label: "Member",
                                  value: OrganizationUserRole.MEMBER,
                                  description:
                                    "Can manage their own projects and view other projects",
                                },
                                {
                                  label: "External / Viewer",
                                  value: OrganizationUserRole.EXTERNAL,
                                  description:
                                    "Can only view projects they are invited to, cannot see costs",
                                },
                              ]}
                              hideSelectedOptions={false}
                              isSearchable={false}
                              useBasicStyles
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
                                        color={
                                          props.isSelected
                                            ? "white"
                                            : "gray.500"
                                        }
                                        fontSize="13px"
                                      >
                                        {props.data.description}
                                      </Text>
                                    </VStack>
                                  </chakraComponents.Option>
                                ),
                              }}
                            />
                          )}
                        />
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
                              variant="plain"
                            />
                          )}
                        />
                      </Td>
                      <Td paddingLeft={0} paddingRight={0} paddingY={2}>
                        <Button
                          type="button"
                          colorPalette="red"
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
                colorPalette={
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
