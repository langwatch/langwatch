import {
  Button,
  Card,
  Field,
  HStack,
  Heading,
  Input,
  LinkBox,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { Lock, Mail, MoreVertical, Plus, Trash } from "react-feather";
import { CopyInput } from "../../components/CopyInput";

import { useState } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  type SubmitHandler,
} from "react-hook-form";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import { type PlanInfo } from "../../server/subscriptionHandler";
import { api } from "../../utils/api";

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
    open: isAddMembersOpen,
    onOpen: onAddMembersOpen,
    onClose: onAddMembersClose,
  } = useDisclosure();

  const {
    open: isInviteLinkOpen,
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

          toaster.create({
            title: title,
            description: description,
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          onAddMembersClose();
          resetForm();
          void pendingInvites.refetch();
          if (newInvites.length > 0) {
            onInviteLinkOpen();
          }
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
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
          toaster.create({
            title: "Member removed successfully",
            description: "The member has been removed from the organization.",
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          // how to refect this organizationWithMembers
          void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
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
          toaster.create({
            title: "Invite deleted successfully",
            description: "The invite has been deleted.",
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
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
            <Tooltip
              content="Upgrade your plan to add more members"
              positioning={{ placement: "top" }}
            >
              <Button size="sm" colorPalette="orange" disabled={true}>
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
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Email</Table.ColumnHeader>
                  <Table.ColumnHeader>Role</Table.ColumnHeader>
                  <Table.ColumnHeader>Teams</Table.ColumnHeader>
                  <Table.ColumnHeader>Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {organization.members.map((member) => (
                  <LinkBox as={Table.Row} key={member.userId}>
                    <Table.Cell>{member.user.name}</Table.Cell>
                    <Table.Cell>{member.user.email}</Table.Cell>
                    <Table.Cell>{member.role}</Table.Cell>
                    <Table.Cell>
                      {member.user.teamMemberships
                        .flatMap((tmember) => tmember.team)
                        .filter(
                          (tmember) => tmember.organizationId == organization.id
                        )
                        .map((tmember) => tmember.name)
                        .join(", ")}
                    </Table.Cell>
                    <Table.Cell>
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <Button
                            variant={"ghost"}
                            // loading={
                            //   deleteGraphs.isLoading &&
                            //   deleteGraphs.variables?.id === graph.id
                            // }
                          >
                            <MoreVertical />
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Item
                            value="remove"
                            color="red.600"
                            disabled={organization.members.length === 1}
                            onClick={() => deleteMember(member.userId)}
                          >
                            <Trash size={14} style={{ marginRight: "8px" }} />
                            Remove Member
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Root>
                    </Table.Cell>
                  </LinkBox>
                ))}
              </Table.Body>
            </Table.Root>

            {pendingInvites.data && pendingInvites.data.length > 0 && (
              <>
                <Heading size="sm" as="h2" paddingY={4} marginLeft={6}>
                  Pending Invites
                </Heading>

                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Email</Table.ColumnHeader>
                      <Table.ColumnHeader>Role</Table.ColumnHeader>
                      <Table.ColumnHeader>Teams</Table.ColumnHeader>
                      <Table.ColumnHeader>Actions</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {pendingInvites.data?.map((invite) => (
                      <Table.Row key={invite.id}>
                        <Table.Cell>{invite.email}</Table.Cell>
                        <Table.Cell>{invite.role}</Table.Cell>
                        <Table.Cell>
                          {invite.teamIds
                            .split(",")
                            .map(
                              (teamId) =>
                                teams.find((team) => team.id == teamId)?.name
                            )
                            .join(", ")}
                        </Table.Cell>
                        <Table.Cell>
                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <Button variant={"ghost"}>
                                {deleteInviteMutation.isLoading &&
                                invite.id ===
                                  deleteInviteMutation.variables?.inviteId ? (
                                  <Spinner size="sm" />
                                ) : (
                                  <MoreVertical />
                                )}
                              </Button>
                            </Menu.Trigger>
                            <Menu.Content>
                              <Menu.Item
                                value="delete"
                                color="red.600"
                                onClick={() => deleteInvite(invite.id)}
                              >
                                <Trash
                                  size={14}
                                  style={{ marginRight: "8px" }}
                                />
                                Delete
                              </Menu.Item>
                              <Menu.Item
                                value="view"
                                onClick={() =>
                                  viewInviteLink(
                                    invite.inviteCode,
                                    invite.email
                                  )
                                }
                              >
                                <Mail
                                  size={14}
                                  style={{ marginRight: "8px" }}
                                />
                                View Invite Link
                              </Menu.Item>
                            </Menu.Content>
                          </Menu.Root>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </>
            )}
          </Card.Body>
        </Card.Root>
      </VStack>

      <Dialog.Root
        open={isInviteLinkOpen}
        onOpenChange={({ open }) =>
          open ? onInviteLinkOpen() : onInviteModalClose()
        }
      >
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <HStack>
                <Mail />
                <Text>Invite Link</Text>
              </HStack>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
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
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={isAddMembersOpen}
        onOpenChange={({ open }) =>
          open ? onAddMembersOpen() : onAddMembersClose()
        }
      >
        <Dialog.Backdrop />
        <Dialog.Content width="100%" maxWidth="1024px">
          <Dialog.Header>
            <Dialog.Title>Add members</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit(onSubmit)(e);
            }}
          >
            <Dialog.Body>
              <Table.Root variant="line" width="100%">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                      Email
                    </Table.ColumnHeader>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                      Role
                    </Table.ColumnHeader>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                      Teams
                    </Table.ColumnHeader>
                    <Table.ColumnHeader
                      paddingLeft={0}
                      paddingRight={0}
                      paddingTop={0}
                    ></Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {fields.map((field, index) => (
                    <Table.Row key={field.id}>
                      <Table.Cell paddingLeft={0} paddingY={2}>
                        <Field.Root>
                          <Input
                            placeholder="Enter email address"
                            {...register(`invites.${index}.email`, {
                              required: "Email is required",
                            })}
                          />
                          <Field.ErrorText>
                            {errors.invites?.[index]?.email &&
                              "Email is required"}
                          </Field.ErrorText>
                        </Field.Root>
                      </Table.Cell>
                      <Table.Cell width="24%" paddingLeft={0} paddingY={2}>
                        <Field.Root>
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
                          <Field.ErrorText>
                            {errors.invites?.[index]?.role &&
                              "Role is required"}
                          </Field.ErrorText>
                        </Field.Root>
                      </Table.Cell>
                      <Table.Cell width="35%" paddingLeft={0} paddingY={2}>
                        <Field.Root>
                          <Controller
                            control={control}
                            name={`invites.${index}.teamOptions`}
                            rules={{
                              required: "At least one team is required",
                            }}
                            render={({ field }) => (
                              <MultiSelect
                                {...field}
                                options={teamOptions}
                                isMulti
                                closeMenuOnSelect={false}
                                selectedOptionStyle="check"
                                hideSelectedOptions={false}
                              />
                            )}
                          />
                        </Field.Root>
                      </Table.Cell>
                      <Table.Cell paddingLeft={0} paddingRight={0} paddingY={2}>
                        <Button
                          type="button"
                          colorPalette="red"
                          onClick={() => remove(index)}
                        >
                          <Trash size={18} />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Button type="button" onClick={onAddField} marginTop={2}>
                + Add Another
              </Button>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                colorPalette={
                  createInvitesMutation.isLoading ? "gray" : "orange"
                }
                type="submit"
                disabled={createInvitesMutation.isLoading}
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
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}
