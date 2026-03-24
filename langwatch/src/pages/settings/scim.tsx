import {
  Badge,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Key, Link, Plus, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { CopyInput } from "../../components/CopyInput";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
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

function GroupMappingsSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const teamMappings = api.scimToken.listTeamMappings.useQuery({
    organizationId,
  });
  const linkMutation = api.scimToken.linkTeam.useMutation();
  const unlinkMutation = api.scimToken.unlinkTeam.useMutation();
  const queryClient = api.useContext();

  const [linkingTeamId, setLinkingTeamId] = useState<string | null>(null);
  const [scimGroupId, setScimGroupId] = useState("");

  const handleLink = (teamId: string) => {
    if (!scimGroupId.trim()) return;

    linkMutation.mutate(
      { organizationId, teamId, externalScimId: scimGroupId.trim() },
      {
        onSuccess: () => {
          setLinkingTeamId(null);
          setScimGroupId("");
          toaster.create({
            title: "Team linked to SCIM group",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.scimToken.listTeamMappings.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Failed to link team",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleUnlink = (teamId: string) => {
    unlinkMutation.mutate(
      { organizationId, teamId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Team unlinked from SCIM group",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.scimToken.listTeamMappings.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Failed to unlink team",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <>
      <HStack width="full" paddingTop={4}>
        <Heading size="md">Group Mappings</Heading>
        <Spacer />
      </HStack>

      <Text fontSize="sm" color="gray.500">
        SCIM groups from your identity provider are mapped to LangWatch teams.
        When users are added to or removed from a group in Okta/Azure AD, their
        team membership in LangWatch is updated automatically. Groups are linked
        automatically by name when pushed, or you can link them manually below.
      </Text>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Team</Table.ColumnHeader>
                <Table.ColumnHeader>SCIM Group ID</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader width="100px"></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {teamMappings.data?.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={4}>
                    <Text color="gray.500" textAlign="center" paddingY={4}>
                      No teams found. Create teams first, then map them to SCIM
                      groups.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
              {teamMappings.data?.map((team) => (
                <Table.Row key={team.id}>
                  <Table.Cell>
                    <Text fontWeight="500">{team.name}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    {linkingTeamId === team.id ? (
                      <HStack>
                        <Input
                          size="sm"
                          placeholder="Enter SCIM Group ID"
                          value={scimGroupId}
                          onChange={(e) => setScimGroupId(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleLink(team.id);
                            if (e.key === "Escape") {
                              setLinkingTeamId(null);
                              setScimGroupId("");
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          size="xs"
                          onClick={() => handleLink(team.id)}
                          disabled={!scimGroupId.trim()}
                        >
                          Save
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setLinkingTeamId(null);
                            setScimGroupId("");
                          }}
                        >
                          Cancel
                        </Button>
                      </HStack>
                    ) : (
                      <Text
                        fontSize="sm"
                        color={team.externalScimId ? "inherit" : "gray.400"}
                        fontFamily={team.externalScimId ? "mono" : undefined}
                      >
                        {team.externalScimId ?? "Not linked"}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {team.externalScimId ? (
                      <Badge colorPalette="green" size="sm">
                        Linked
                      </Badge>
                    ) : (
                      <Badge colorPalette="gray" size="sm">
                        Unlinked
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {team.externalScimId ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        onClick={() => handleUnlink(team.id)}
                        disabled={unlinkMutation.isLoading}
                      >
                        <Unlink size={14} />
                        Unlink
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setLinkingTeamId(team.id);
                          setScimGroupId("");
                        }}
                      >
                        <Link size={14} />
                        Link
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </>
  );
}
