import {
  Badge,
  Button,
  Card,
  createListCollection,
  Heading,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Key, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyInput } from "../../components/CopyInput";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { toaster } from "../../components/ui/toaster";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function ScimSettings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return <ScimSettingsContent organizationId={organization.id} />;
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(ScimSettings);

function ScimSettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const tokens = api.scimToken.list.useQuery({ organizationId });
  const generateMutation = api.scimToken.generate.useMutation();
  const revokeMutation = api.scimToken.revoke.useMutation();
  const queryClient = api.useContext();

  const {
    open: isGenerateOpen,
    onOpen: onGenerateOpen,
    onClose: onGenerateClose,
  } = useDisclosure();

  const [description, setDescription] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const handleGenerate = () => {
    generateMutation.mutate(
      { organizationId, description: description || undefined },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setDescription("");
          void queryClient.scimToken.list.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Failed to generate token",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleRevoke = (tokenId: string) => {
    revokeMutation.mutate(
      { organizationId, tokenId },
      {
        onSuccess: () => {
          setTokenToRevoke(null);
          toaster.create({
            title: "Token revoked",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.scimToken.list.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Failed to revoke token",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const scimBaseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/scim/v2`
      : "";

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>SCIM Provisioning</Heading>
          <Spacer />
        </HStack>

        <Card.Root width="full">
          <Card.Body>
            <VStack gap={4} align="start">
              <Text>
                SCIM (System for Cross-domain Identity Management) allows your
                identity provider (Okta, Azure AD, etc.) to automatically
                provision and deprovision users in LangWatch.
              </Text>

              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600">SCIM Base URL</Text>
                <CopyInput value={scimBaseUrl} label="SCIM Base URL" />
              </VStack>

              <Text fontSize="sm" color="gray.500">
                Use this URL and a bearer token below to configure SCIM in your
                identity provider.
              </Text>
            </VStack>
          </Card.Body>
        </Card.Root>

        <HStack width="full">
          <Heading size="md">Bearer Tokens</Heading>
          <Spacer />
          <Button size="sm" onClick={onGenerateOpen}>
            <Plus size={16} />
            Generate Token
          </Button>
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Description</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {tokens.data?.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={4}>
                      <Text color="gray.500" textAlign="center" paddingY={4}>
                        No SCIM tokens yet. Generate one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {tokens.data?.map((token) => (
                  <Table.Row key={token.id}>
                    <Table.Cell>
                      <HStack>
                        <Key size={14} />
                        <Text>{token.description ?? "No description"}</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(token.createdAt).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell>
                      {token.lastUsedAt ? (
                        new Date(token.lastUsedAt).toLocaleDateString()
                      ) : (
                        <Badge size="sm" colorPalette="gray">
                          Never
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        onClick={() => setTokenToRevoke(token.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
        <GroupMappingsSection organizationId={organizationId} />
      </VStack>

      {/* Generate Token Dialog */}
      <Dialog.Root
        open={isGenerateOpen && !newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            onGenerateClose();
            setDescription("");
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Generate SCIM Token</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                This token will be used by your identity provider to
                authenticate SCIM requests.
              </Text>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Description (optional)
                </Text>
                <Input
                  placeholder="e.g., Okta SCIM integration"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </VStack>
              <Button
                width="full"
                onClick={handleGenerate}
                disabled={generateMutation.isLoading}
              >
                Generate Token
              </Button>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      {/* Show Token Dialog */}
      <Dialog.Root
        open={!!newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            setNewToken(null);
            onGenerateClose();
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Token Generated</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text color="orange.500" fontWeight="600">
                Copy this token now. You won&apos;t be able to see it again.
              </Text>
              {newToken && (
                <CopyInput value={newToken} label="SCIM Token" />
              )}
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      {/* Revoke Confirmation Dialog */}
      <Dialog.Root
        open={!!tokenToRevoke}
        onOpenChange={({ open }) => {
          if (!open) setTokenToRevoke(null);
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Revoke Token</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                Are you sure you want to revoke this token? Any identity
                provider using it will no longer be able to provision users.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button
                  variant="outline"
                  onClick={() => setTokenToRevoke(null)}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => tokenToRevoke && handleRevoke(tokenToRevoke)}
                  disabled={revokeMutation.isLoading}
                >
                  Revoke
                </Button>
              </HStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}

type MappingRow = {
  id: string;
  externalGroupId: string;
  externalGroupName: string;
  teamId: string | null;
  teamName: string | null;
  projectName: string | null;
  role: TeamUserRole | null;
  customRoleId: string | null;
  customRoleName: string | null;
  memberCount: number;
  mapped: boolean;
};

const CREATE_NEW_TEAM_VALUE = "__create_new_team__";

function GroupMappingsSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const mappings = api.scimGroupMapping.listAll.useQuery({ organizationId });
  const queryClient = api.useContext();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingMapping, setDeletingMapping] = useState<MappingRow | null>(
    null,
  );

  const handleSaved = () => {
    setEditingId(null);
    void queryClient.scimGroupMapping.listAll.invalidate();
  };

  const handleDeleted = () => {
    setDeletingMapping(null);
    void queryClient.scimGroupMapping.listAll.invalidate();
  };

  return (
    <>
      <HStack width="full" paddingTop={4}>
        <Heading size="md">Group Mappings</Heading>
        <Spacer />
      </HStack>

      <Text fontSize="sm" color="gray.500">
        SCIM groups from your identity provider are mapped to LangWatch teams.
        When users are added to or removed from a group in Entra/Okta, their
        team membership in LangWatch is updated automatically.
      </Text>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Entra Group Name</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Team</Table.ColumnHeader>
                <Table.ColumnHeader>Project</Table.ColumnHeader>
                <Table.ColumnHeader>Role</Table.ColumnHeader>
                <Table.ColumnHeader>Members</Table.ColumnHeader>
                <Table.ColumnHeader width="120px"></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {mappings.data?.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={7}>
                    <Text color="gray.500" textAlign="center" paddingY={4}>
                      No SCIM groups have been pushed yet. Groups will appear
                      here once your identity provider pushes them via SCIM.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
              {mappings.data?.map((mapping) => (
                <MappingTableRow
                  key={mapping.id}
                  mapping={mapping}
                  organizationId={organizationId}
                  isEditing={editingId === mapping.id}
                  onEdit={() => setEditingId(mapping.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaved={handleSaved}
                  onDelete={() => setDeletingMapping(mapping)}
                />
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>

      <DeleteMappingDialog
        mapping={deletingMapping}
        organizationId={organizationId}
        onClose={() => setDeletingMapping(null)}
        onDeleted={handleDeleted}
      />
    </>
  );
}

function MappingTableRow({
  mapping,
  organizationId,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaved,
  onDelete,
}: {
  mapping: MappingRow;
  organizationId: string;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  if (isEditing) {
    return (
      <Table.Row>
        <Table.Cell colSpan={7}>
          <MappingInlineForm
            mapping={mapping}
            organizationId={organizationId}
            onSaved={onSaved}
            onCancel={onCancelEdit}
          />
        </Table.Cell>
      </Table.Row>
    );
  }

  const roleName = mapping.role === TeamUserRole.CUSTOM
    ? mapping.customRoleName ?? "Custom"
    : mapping.role ?? "-";

  return (
    <Table.Row>
      <Table.Cell>
        <Text fontWeight="500">{mapping.externalGroupName}</Text>
      </Table.Cell>
      <Table.Cell>
        {mapping.mapped ? (
          <Badge colorPalette="green" size="sm">Mapped</Badge>
        ) : (
          <Badge colorPalette="yellow" size="sm">Unmapped</Badge>
        )}
      </Table.Cell>
      <Table.Cell>{mapping.teamName ?? "-"}</Table.Cell>
      <Table.Cell>{mapping.projectName ?? "-"}</Table.Cell>
      <Table.Cell>{roleName}</Table.Cell>
      <Table.Cell>{mapping.memberCount}</Table.Cell>
      <Table.Cell>
        <HStack gap={1}>
          <Button size="xs" variant="ghost" onClick={onEdit} aria-label="Edit mapping">
            <Pencil size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            onClick={onDelete}
            aria-label="Delete mapping"
          >
            <Trash2 size={14} />
          </Button>
        </HStack>
      </Table.Cell>
    </Table.Row>
  );
}

function MappingInlineForm({
  mapping,
  organizationId,
  onSaved,
  onCancel,
}: {
  mapping: MappingRow;
  organizationId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const teams = api.team.getTeamsWithMembers.useQuery({ organizationId });
  const customRoles = api.role.getAll.useQuery({ organizationId });
  const createMutation = api.scimGroupMapping.create.useMutation();
  const createWithNewTeamMutation =
    api.scimGroupMapping.createWithNewTeam.useMutation();
  const updateMutation = api.scimGroupMapping.update.useMutation();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    mapping.teamId,
  );
  const [isCreatingNewTeam, setIsCreatingNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedRole, setSelectedRole] = useState<string>(
    mapping.role === TeamUserRole.CUSTOM && mapping.customRoleId
      ? `custom:${mapping.customRoleId}`
      : (mapping.role ?? "MEMBER"),
  );

  const teamsByProject = useMemo(() => {
    if (!teams.data) return [];
    const projectMap = new Map<
      string,
      { projectId: string; projectName: string; teams: { id: string; name: string }[] }
    >();

    for (const team of teams.data) {
      for (const project of team.projects) {
        const existing = projectMap.get(project.id);
        if (existing) {
          existing.teams.push({ id: team.id, name: team.name });
        } else {
          projectMap.set(project.id, {
            projectId: project.id,
            projectName: project.name,
            teams: [{ id: team.id, name: team.name }],
          });
        }
      }
      // Teams without projects
      if (team.projects.length === 0) {
        const existing = projectMap.get("__no_project__");
        if (existing) {
          existing.teams.push({ id: team.id, name: team.name });
        } else {
          projectMap.set("__no_project__", {
            projectId: "__no_project__",
            projectName: "No Project",
            teams: [{ id: team.id, name: team.name }],
          });
        }
      }
    }

    return Array.from(projectMap.values());
  }, [teams.data]);

  const teamItems = useMemo(() => {
    const items: { label: string; value: string }[] = [];
    for (const group of teamsByProject) {
      for (const team of group.teams) {
        items.push({
          label: `${team.name} (${group.projectName})`,
          value: team.id,
        });
      }
    }
    items.push({ label: "Create new team...", value: CREATE_NEW_TEAM_VALUE });
    return items;
  }, [teamsByProject]);

  const teamCollection = useMemo(
    () => createListCollection({ items: teamItems }),
    [teamItems],
  );

  const projectItems = useMemo(() => {
    return teamsByProject
      .filter((g) => g.projectId !== "__no_project__")
      .map((g) => ({ label: g.projectName, value: g.projectId }));
  }, [teamsByProject]);

  const projectCollection = useMemo(
    () => createListCollection({ items: projectItems }),
    [projectItems],
  );

  const roleItems = useMemo(() => {
    const items = [
      { label: "Admin", value: "ADMIN" },
      { label: "Member", value: "MEMBER" },
      { label: "Viewer", value: "VIEWER" },
      ...(customRoles.data ?? []).map((role) => ({
        label: role.name,
        value: `custom:${role.id}`,
      })),
    ];
    return items;
  }, [customRoles.data]);

  const roleCollection = useMemo(
    () => createListCollection({ items: roleItems }),
    [roleItems],
  );

  const isSaving =
    createMutation.isLoading ||
    createWithNewTeamMutation.isLoading ||
    updateMutation.isLoading;

  const handleSave = () => {
    const roleEnum = selectedRole.startsWith("custom:")
      ? TeamUserRole.CUSTOM
      : (selectedRole as TeamUserRole);
    const customRoleId = selectedRole.startsWith("custom:")
      ? selectedRole.replace("custom:", "")
      : undefined;

    if (isCreatingNewTeam) {
      if (!selectedProjectId || !newTeamName.trim()) return;
      createWithNewTeamMutation.mutate(
        {
          organizationId,
          mappingId: mapping.id,
          projectId: selectedProjectId,
          teamName: newTeamName.trim(),
          role: roleEnum,
          customRoleId,
        },
        {
          onSuccess: () => {
            toaster.create({
              title: "Mapping saved",
              type: "success",
              duration: 3000,
              meta: { closable: true },
            });
            onSaved();
          },
          onError: () => {
            toaster.create({
              title: "Failed to save mapping",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          },
        },
      );
    } else if (mapping.mapped) {
      // Update existing mapping
      updateMutation.mutate(
        {
          organizationId,
          mappingId: mapping.id,
          role: roleEnum,
          customRoleId,
        },
        {
          onSuccess: () => {
            toaster.create({
              title: "Mapping updated",
              type: "success",
              duration: 3000,
              meta: { closable: true },
            });
            onSaved();
          },
          onError: () => {
            toaster.create({
              title: "Failed to update mapping",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          },
        },
      );
    } else {
      // Create new mapping with existing team
      if (!selectedTeamId) return;
      createMutation.mutate(
        {
          organizationId,
          mappingId: mapping.id,
          teamId: selectedTeamId,
          role: roleEnum,
          customRoleId,
        },
        {
          onSuccess: () => {
            toaster.create({
              title: "Mapping saved",
              type: "success",
              duration: 3000,
              meta: { closable: true },
            });
            onSaved();
          },
          onError: () => {
            toaster.create({
              title: "Failed to save mapping",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          },
        },
      );
    }
  };

  return (
    <VStack gap={3} align="start" paddingY={2}>
      <Text fontWeight="600">{mapping.externalGroupName}</Text>

      {!isCreatingNewTeam && (
        <HStack gap={3} align="end" width="full">
          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="500">Team</Text>
            <Select.Root
              collection={teamCollection}
              value={selectedTeamId ? [selectedTeamId] : []}
              onValueChange={(details) => {
                const val = details.value[0];
                if (val === CREATE_NEW_TEAM_VALUE) {
                  setIsCreatingNewTeam(true);
                  setSelectedTeamId(null);
                } else if (val) {
                  setSelectedTeamId(val);
                }
              }}
              disabled={mapping.mapped}
            >
              <Select.Trigger width="250px" background="bg">
                <Select.ValueText placeholder="Select team" />
              </Select.Trigger>
              <Select.Content width="300px" paddingY={2}>
                {teamItems.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </VStack>

          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="500">Role</Text>
            <Select.Root
              collection={roleCollection}
              value={[selectedRole]}
              onValueChange={(details) => {
                const val = details.value[0];
                if (val) setSelectedRole(val);
              }}
            >
              <Select.Trigger width="180px" background="bg">
                <Select.ValueText placeholder="Select role" />
              </Select.Trigger>
              <Select.Content width="250px" paddingY={2}>
                {roleItems.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </VStack>
        </HStack>
      )}

      {isCreatingNewTeam && (
        <HStack gap={3} align="end" width="full" flexWrap="wrap">
          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="500">Project</Text>
            <Select.Root
              collection={projectCollection}
              value={selectedProjectId ? [selectedProjectId] : []}
              onValueChange={(details) => {
                const val = details.value[0];
                if (val) setSelectedProjectId(val);
              }}
            >
              <Select.Trigger width="200px" background="bg">
                <Select.ValueText placeholder="Select project" />
              </Select.Trigger>
              <Select.Content width="250px" paddingY={2}>
                {projectItems.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </VStack>

          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="500">Team name</Text>
            <Input
              size="sm"
              width="200px"
              placeholder="Enter team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
          </VStack>

          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="500">Role</Text>
            <Select.Root
              collection={roleCollection}
              value={[selectedRole]}
              onValueChange={(details) => {
                const val = details.value[0];
                if (val) setSelectedRole(val);
              }}
            >
              <Select.Trigger width="180px" background="bg">
                <Select.ValueText placeholder="Select role" />
              </Select.Trigger>
              <Select.Content width="250px" paddingY={2}>
                {roleItems.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </VStack>
        </HStack>
      )}

      <HStack gap={2}>
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {isCreatingNewTeam && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsCreatingNewTeam(false);
              setNewTeamName("");
              setSelectedProjectId(null);
            }}
          >
            Back to team list
          </Button>
        )}
      </HStack>
    </VStack>
  );
}

function DeleteMappingDialog({
  mapping,
  organizationId,
  onClose,
  onDeleted,
}: {
  mapping: MappingRow | null;
  organizationId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = api.scimGroupMapping.delete.useMutation();

  const handleDelete = () => {
    if (!mapping) return;
    deleteMutation.mutate(
      { organizationId, mappingId: mapping.id },
      {
        onSuccess: () => {
          toaster.create({
            title: "Mapping deleted",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          onDeleted();
        },
        onError: () => {
          toaster.create({
            title: "Failed to delete mapping",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <Dialog.Root
      open={!!mapping}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            <Heading size="md">Delete Mapping</Heading>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text>
              Are you sure you want to delete the mapping for group{" "}
              <Text as="span" fontWeight="600">
                {mapping?.externalGroupName}
              </Text>
              ? Members who were only in the team via this mapping will be
              removed.
            </Text>
            <HStack width="full" justify="end" gap={2}>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={handleDelete}
                disabled={deleteMutation.isLoading}
              >
                Delete
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
