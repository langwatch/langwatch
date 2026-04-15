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
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { Key, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyInput } from "../../components/CopyInput";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";

const ROLE_OPTIONS = [
  { label: "Admin", value: TeamUserRole.ADMIN, description: "Full access" },
  {
    label: "Member",
    value: TeamUserRole.MEMBER,
    description: "Read + write access",
  },
  {
    label: "Viewer",
    value: TeamUserRole.VIEWER,
    description: "Read-only access",
  },
];

const roleCollection = createListCollection({ items: ROLE_OPTIONS });

function roleSummary(
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>,
): string {
  if (bindings.length === 0) return "No permissions";
  const first = bindings[0]!;
  const scope =
    first.scopeType === "ORGANIZATION"
      ? "Org-wide"
      : first.scopeType === "TEAM"
        ? "Team"
        : "Project";
  const suffix = bindings.length > 1 ? ` +${bindings.length - 1} more` : "";
  return `${first.role} (${scope})${suffix}`;
}

export default function PersonalAccessTokensPage() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return <PatSettingsContent organizationId={organization.id} />;
}

function PatSettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const { data: session } = useRequiredSession();
  const pats = api.personalAccessToken.list.useQuery({ organizationId });
  const createMutation = api.personalAccessToken.create.useMutation();
  const revokeMutation = api.personalAccessToken.revoke.useMutation();
  const queryClient = api.useContext();

  const {
    open: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const [name, setName] = useState("");
  const [selectedRole, setSelectedRole] = useState<TeamUserRole>(
    TeamUserRole.MEMBER,
  );
  const [newToken, setNewToken] = useState<string | null>(null);
  const [patToRevoke, setPatToRevoke] = useState<string | null>(null);

  const handleCreate = () => {
    createMutation.mutate(
      {
        organizationId,
        name,
        bindings: [
          {
            role: selectedRole,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setName("");
          setSelectedRole(TeamUserRole.MEMBER);
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to create token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleRevoke = (patId: string) => {
    revokeMutation.mutate(
      { organizationId, patId },
      {
        onSuccess: () => {
          setPatToRevoke(null);
          toaster.create({
            title: "Token revoked",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to revoke token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const activePats = useMemo(
    () => pats.data?.filter((p) => !p.revokedAt) ?? [],
    [pats.data],
  );

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>Personal Access Tokens</Heading>
          <Spacer />
          <Button size="sm" onClick={onCreateOpen}>
            <Plus size={16} />
            Create Token
          </Button>
        </HStack>

        <Card.Root width="full">
          <Card.Body>
            <Text>
              Personal access tokens are used to authenticate API requests on
              your behalf. Each token carries specific permissions and is tied
              to your account. The token is shown once at creation — copy it
              immediately.
            </Text>
          </Card.Body>
        </Card.Root>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activePats.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={5}>
                      <Text color="gray.500" textAlign="center" paddingY={4}>
                        No active tokens. Create one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {activePats.map((pat) => (
                  <Table.Row key={pat.id}>
                    <Table.Cell>
                      <HStack>
                        <Key size={14} />
                        <Text>{pat.name}</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="gray.600">
                        {roleSummary(pat.roleBindings)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(pat.createdAt).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell>
                      {pat.lastUsedAt ? (
                        new Date(pat.lastUsedAt).toLocaleDateString()
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
                        onClick={() => setPatToRevoke(pat.id)}
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
      </VStack>

      {/* Create Token Dialog */}
      <Dialog.Root
        open={isCreateOpen && !newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            onCreateClose();
            setName("");
            setSelectedRole(TeamUserRole.MEMBER);
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              Create Personal Access Token
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Token Name
                </Text>
                <Input
                  placeholder="e.g., CI Pipeline, Local Dev"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </VStack>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Role
                </Text>
                <Select.Root
                  collection={roleCollection}
                  value={[selectedRole]}
                  onValueChange={(details) => {
                    const val = details.value[0] as TeamUserRole | undefined;
                    if (val) setSelectedRole(val);
                  }}
                >
                  <Select.Trigger width="full" background="bg">
                    <Select.ValueText placeholder="Select role" />
                  </Select.Trigger>
                  <Select.Content width="300px" paddingY={2}>
                    {ROLE_OPTIONS.map((option) => (
                      <Select.Item key={option.value} item={option}>
                        <VStack align="start" gap={0}>
                          <Text>{option.label}</Text>
                          <Text color="fg.muted" fontSize="xs">
                            {option.description}
                          </Text>
                        </VStack>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </VStack>
              <Text fontSize="sm" color="gray.500">
                The token will have organization-wide permissions with the
                selected role. Your own permissions act as a ceiling — the token
                can never exceed your access.
              </Text>
              <Button
                width="full"
                onClick={handleCreate}
                disabled={createMutation.isLoading || !name.trim()}
              >
                Create Token
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
            onCreateClose();
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              Token Created
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text color="orange.500" fontWeight="600">
                Copy this token now. You won&apos;t be able to see it again.
              </Text>
              {newToken && (
                <CopyInput value={newToken} label="Personal Access Token" />
              )}
              <Text fontSize="sm" color="gray.500">
                Use this token with the Authorization header:{" "}
                <code>Authorization: Bearer pat-lw-...</code> along with the{" "}
                <code>X-Project-Id</code> header, or use Basic Auth:{" "}
                <code>
                  Authorization: Basic base64(projectId:pat-lw-...)
                </code>
              </Text>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      {/* Revoke Confirmation Dialog */}
      <Dialog.Root
        open={!!patToRevoke}
        onOpenChange={({ open }) => {
          if (!open) setPatToRevoke(null);
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              Revoke Token
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                Are you sure you want to revoke this token? Any integration
                using it will stop working immediately.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button
                  variant="outline"
                  onClick={() => setPatToRevoke(null)}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => patToRevoke && handleRevoke(patToRevoke)}
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
