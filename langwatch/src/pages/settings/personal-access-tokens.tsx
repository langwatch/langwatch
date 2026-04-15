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

const EXPIRATION_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom...", value: "custom" },
];

const expirationCollection = createListCollection({ items: EXPIRATION_OPTIONS });

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
  const { organization, project } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return <PatSettingsContent organizationId={organization.id} projectId={project?.id} />;
}

function PatSettingsContent({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  useRequiredSession();
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
  const [expirationPreset, setExpirationPreset] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [patToRevoke, setPatToRevoke] = useState<string | null>(null);

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    createMutation.mutate(
      {
        organizationId,
        name,
        expiresAt,
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
          setExpirationPreset("");
          setCustomDate("");
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
                  <Table.ColumnHeader>Expires</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activePats.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6}>
                      <Text color="fg.muted" textAlign="center" paddingY={4}>
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
                      <Text fontSize="sm" color="fg.muted">
                        {roleSummary(pat.roleBindings)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {pat.expiresAt ? (
                        new Date(pat.expiresAt) < new Date() ? (
                          <Badge size="sm" colorPalette="red">Expired</Badge>
                        ) : (
                          new Date(pat.expiresAt).toLocaleDateString()
                        )
                      ) : (
                        <Badge size="sm" colorPalette="gray">Never</Badge>
                      )}
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
        size="lg"
        open={isCreateOpen && !newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            onCreateClose();
            setName("");
            setSelectedRole(TeamUserRole.MEMBER);
            setExpirationPreset("");
            setCustomDate("");
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
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Expiration
                </Text>
                <Select.Root
                  collection={expirationCollection}
                  value={[expirationPreset]}
                  onValueChange={(details) => {
                    const val = details.value[0] ?? "";
                    setExpirationPreset(val);
                    if (val !== "custom") setCustomDate("");
                  }}
                >
                  <Select.Trigger width="full" background="bg">
                    <Select.ValueText placeholder="No expiration" />
                  </Select.Trigger>
                  <Select.Content width="300px" paddingY={2}>
                    {EXPIRATION_OPTIONS.map((option) => (
                      <Select.Item key={option.value} item={option}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {expirationPreset === "custom" && (
                  <Input
                    type="date"
                    value={customDate}
                    min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                )}
              </VStack>
              <Text fontSize="sm" color="fg.muted">
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
        size="lg"
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
              <Text color="orange.400" fontWeight="600">
                Copy this token now. You won&apos;t be able to see it again.
              </Text>
              {newToken && (
                <CopyInput value={newToken} label="Personal Access Token" />
              )}
              {projectId && (
                <CopyInput value={projectId} label="Project ID" />
              )}
              <Text fontSize="sm" color="fg.muted">
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
        size="lg"
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
