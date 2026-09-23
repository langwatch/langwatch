// SCIM provisioning at /settings/scim: endpoint address and bearer token.
// Token shown exactly once; unrecoverable after dialog closes. No chrome.

import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { scimApi } from "../../behavior/scim-api.ts";
import {
  chosenConnectionOf,
  isActiveConnection,
  isRunningConnection,
} from "../../model/connection-lifecycle.ts";
import { connectionLabel, readableDate } from "../../model/display-formatters.ts";
import { useScimHost } from "../../model/scim-host.ts";
import { CopyInput } from "../../ui/elements/copy-input.tsx";
import { DirectoryReconciliation } from "./directory-reconciliation.tsx";
import { DirectoryRequests } from "./directory-requests.tsx";

export default function ScimScreen() {
  const organizationId = useScimHost().organizationId();

  if (!organizationId) return null;

  return <ScimSettingsContent organizationId={organizationId} title="SCIM Provisioning" />;
}

export function ScimSettingsContent({
  organizationId,
  title,
  lede,
}: {
  organizationId: string;
  title: string;
  /** One line under the title saying what the page is for. */
  lede?: string;
}) {
  const host = useScimHost();
  const tokens = scimApi.scimToken.list.useQuery({ organizationId });
  const connections = scimApi.scimToken.connections.useQuery({ organizationId });
  const generateMutation = scimApi.scimToken.generate.useMutation();
  const revokeMutation = scimApi.scimToken.revoke.useMutation();
  const queryClient = scimApi.useUtils();

  const {
    open: isGenerateOpen,
    onOpen: onGenerateOpen,
    onClose: onGenerateClose,
  } = useDisclosure();

  const [description, setDescription] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const connectionOptions = connections.data ?? [];
  const labelFor = (id: string | null) =>
    connectionOptions.find((option) => option.connectionId === id)?.displayName ?? id;
  /**
   * Only the connections that could carry a token: one issued against a draft,
   * a rejected claim or a torn-down connection authenticates perfectly and
   * provisions nobody — a dead end found at the provider rather than here.
   */
  const issuableConnections = connectionOptions.filter((option) =>
    isActiveConnection({ connectionState: option.state }),
  );
  const hasIssuableConnection = issuableConnections.length > 0;
  const chosenConnectionId = chosenConnectionOf({ connectionId, issuableConnections });

  const handleGenerate = () => {
    generateMutation.mutate(
      { organizationId, connectionId: chosenConnectionId, description: description || undefined },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setDescription("");
          setConnectionId("");
          void queryClient.scimToken.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Failed to generate token" }),
      },
    );
  };

  const handleRevoke = (tokenId: string) => {
    revokeMutation.mutate(
      { organizationId, tokenId },
      {
        onSuccess: () => {
          setTokenToRevoke(null);
          host.succeeded({ title: "Token revoked" });
          void queryClient.scimToken.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Failed to revoke token" }),
      },
    );
  };

  const scimBaseUrl = host.scimBaseUrl();

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1} width="full">
          <HStack width="full">
            <Heading>{title}</Heading>
            <Spacer />
          </HStack>
          {lede && <Text color="fg.muted">{lede}</Text>}
        </VStack>

        <Card.Root width="full">
          <Card.Body>
            <VStack gap={4} align="start">
              <Text>
                SCIM (System for Cross-domain Identity Management) allows your identity provider
                (Okta, Azure AD, etc.) to automatically provision and deprovision users in
                LangWatch.
              </Text>

              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600">SCIM Base URL</Text>
                <CopyInput value={scimBaseUrl} label="SCIM Base URL" />
              </VStack>

              <Text fontSize="sm" color="gray.500">
                Use this URL and a bearer token below to configure SCIM in your identity provider.
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
          <Card.Body paddingY={0} paddingX={0} overflowX="auto">
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Description</Table.ColumnHeader>
                  <Table.ColumnHeader>Connection</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {tokens.data?.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={5}>
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
                      {/* The full list resolves the name, not just the issuable
                          ones: a retired connection is exactly the row whose
                          name a reader needs. */}
                      <Text>{labelFor(token.connectionId) ?? "Organization-wide"}</Text>
                    </Table.Cell>
                    <Table.Cell>{readableDate(token.createdAt).toLocaleDateString()}</Table.Cell>
                    <Table.Cell>
                      {token.lastUsedAt ? (
                        readableDate(token.lastUsedAt).toLocaleDateString()
                      ) : (
                        // A token nothing recognizes is refused before we know
                        // whose it is, so a mistyped one can never reach the
                        // request list. This is the whole remedy, so it says
                        // what it means and points at the provider.
                        <VStack align="start" gap={0}>
                          <Badge size="sm" colorPalette="gray">
                            Never
                          </Badge>
                          <Text fontSize="xs" color="fg.muted">
                            Nothing has presented this token yet. If your identity provider says it
                            is syncing, check the token it is using.
                          </Text>
                        </VStack>
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

        <DirectoryReconciliation organizationId={organizationId} />

        <DirectoryRequests
          organizationId={organizationId}
          connections={connectionOptions.filter((option) =>
            isRunningConnection({ connectionState: option.state }),
          )}
        />
      </VStack>

      {/* Generate Token Dialog */}
      <Dialog.Root
        open={isGenerateOpen && !newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            onGenerateClose();
            setDescription("");
            setConnectionId("");
          }
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Generate SCIM Token</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                This token manages the people its connection provisioned, so choose the connection
                your identity provider syncs from.
              </Text>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Connection
                </Text>
                {hasIssuableConnection ? (
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      aria-label="Connection"
                      value={chosenConnectionId}
                      onChange={(event) => setConnectionId(event.target.value)}
                    >
                      <option value="">Choose a connection</option>
                      {issuableConnections.map((option) => (
                        <option key={option.connectionId} value={option.connectionId}>
                          {connectionLabel({
                            displayName: option.displayName,
                            connectionType: option.type,
                          })}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                ) : (
                  <Alert.Root status="info">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Waiting for single sign-on</Alert.Title>
                      <Alert.Description>
                        Finish setting up and activate an identity provider connection before
                        issuing a directory sync token.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                )}
              </VStack>
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
                disabled={generateMutation.isPending || !chosenConnectionId}
              >
                Generate Token
              </Button>
              {/* A held button with no sentence is a dead end: the reader
                  cannot tell whether they missed a field or found a bug. */}
              {!generateMutation.isPending && !chosenConnectionId && (
                <Text color="fg.muted" fontSize="xs">
                  {hasIssuableConnection
                    ? "Choose which connection this token provisions for, above."
                    : "A token provisions people for one single sign-on connection, so there has to be a live one first."}
                </Text>
              )}
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
        <Dialog.Content bg="bg">
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
              {newToken && <CopyInput value={newToken} label="SCIM Token" />}
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
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Revoke Token</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                Are you sure you want to revoke this token? Any identity provider using it will no
                longer be able to provision users.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button variant="outline" onClick={() => setTokenToRevoke(null)}>
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => tokenToRevoke && handleRevoke(tokenToRevoke)}
                  disabled={revokeMutation.isPending}
                >
                  Revoke
                </Button>
              </HStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
