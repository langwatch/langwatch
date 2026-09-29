// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The provisioning tokens an organization holds, and the two acts on them.
 * A token is bound to one connection and manages only the people that
 * connection provisioned, so only live connections are offered: a token
 * issued against a draft or a torn-down one authenticates and syncs nobody.
 * Shown once when issued; unrecoverable after the dialog closes.
 */
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
import { HandledErrorAlert } from "@langwatch/error-views";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { scimApi } from "../../behavior/scim-api.ts";
import { chosenConnectionOf, isActiveConnection } from "../../model/connection-lifecycle.ts";
import { connectionLabel, readableDate } from "../../model/display-formatters.ts";
import { useScimHost } from "../../model/scim-host.ts";
import { CopyInput } from "../elements/copy-input.tsx";

export function ProvisioningTokens({
  organizationId,
  mayManage,
}: {
  organizationId: string;
  mayManage: boolean;
}) {
  const tokens = useScimTokens({ organizationId });
  const { list, connections, labelFor, setTokenToRevoke, onGenerateOpen } = tokens;

  return (
    <>
      <VStack width="full" align="stretch" gap={2}>
        <HStack width="full">
          <Heading size="sm">Provisioning tokens</Heading>
          <Spacer />
          {mayManage && (
            <Button size="sm" onClick={onGenerateOpen} data-testid="scim-generate-open">
              <Plus size={16} />
              Issue token
            </Button>
          )}
        </HStack>
        <Text color="fg.muted" fontSize="sm" maxWidth="80ch">
          A provisioning token is the password your identity provider uses to reach us. Set the one
          your provider already has, or let us generate one, and give it the provisioning address.
          The value is shown once when it is issued; if it is lost or leaked, revoke it and issue
          another.
        </Text>
      </VStack>

      {(list.isError || connections.isError) && (
        <HandledErrorAlert
          error={list.error ?? connections.error}
          fallbackTitle="We couldn't load your provisioning tokens"
          onRetry={() => {
            void list.refetch();
            void connections.refetch();
          }}
        />
      )}

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
                <Table.ColumnHeader>Connection</Table.ColumnHeader>
                <Table.ColumnHeader>Issued</Table.ColumnHeader>
                <Table.ColumnHeader>Last used</Table.ColumnHeader>
                {mayManage && <Table.ColumnHeader width="80px" />}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {!list.isError && list.data?.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={mayManage ? 5 : 4}>
                    <Text color="fg.muted" textAlign="center" paddingY={4}>
                      No provisioning token has been issued yet.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
              {list.data?.map((token) => (
                <Table.Row key={token.id}>
                  <Table.Cell>
                    <HStack>
                      <Key size={14} />
                      <Text>{token.description ?? "No description"}</Text>
                    </HStack>
                  </Table.Cell>
                  <Table.Cell>
                    {token.connectionId ? (
                      <Text>{labelFor(token.connectionId)}</Text>
                    ) : (
                      <Badge size="sm" colorPalette="gray">
                        Every connection
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>{readableDate(token.createdAt).toLocaleDateString()}</Table.Cell>
                  <Table.Cell>
                    {token.lastUsedAt ? (
                      readableDate(token.lastUsedAt).toLocaleDateString()
                    ) : (
                      <VStack align="start" gap={0}>
                        <Badge size="sm" colorPalette="gray">
                          Never
                        </Badge>
                        <Text fontSize="xs" color="fg.muted">
                          Nothing has presented this token yet. If your identity provider says it is
                          syncing, check the token it is using.
                        </Text>
                      </VStack>
                    )}
                  </Table.Cell>
                  {mayManage && (
                    <Table.Cell>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        data-testid="scim-token-revoke"
                        aria-label={`Revoke ${token.description ?? "token"}`}
                        onClick={() => setTokenToRevoke(token.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>

      {mayManage && <TokenDialogs tokens={tokens} />}
    </>
  );
}

function useScimTokens({ organizationId }: { organizationId: string }) {
  const host = useScimHost();
  const list = scimApi.scimToken.list.useQuery({ organizationId });
  const connections = scimApi.scimToken.connections.useQuery({ organizationId });
  const generateMutation = scimApi.scimToken.generate.useMutation();
  const revokeMutation = scimApi.scimToken.revoke.useMutation();
  const queryClient = scimApi.useUtils();

  const generateDialog = useDisclosure();
  const [description, setDescription] = useState("");
  const [connectionId, setConnectionId] = useState("");
  /** A value the administrator already has. Empty means "mint one for me". */
  const [secret, setSecret] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const connectionOptions = connections.data ?? [];
  const labelFor = (id: string | null) =>
    connectionOptions.find((option) => option.connectionId === id)?.displayName ?? id;
  const issuableConnections = connectionOptions.filter((option) =>
    isActiveConnection({ connectionState: option.state }),
  );
  const chosenConnectionId = chosenConnectionOf({ connectionId, issuableConnections });

  const refresh = () => {
    void queryClient.scimToken.list.invalidate();
    void queryClient.scimReconciliation.invalidate();
  };

  const handleGenerate = () => {
    const chosen = secret.trim();
    generateMutation.mutate(
      {
        organizationId,
        connectionId: chosenConnectionId,
        description: description || undefined,
        secret: chosen.length > 0 ? chosen : undefined,
      },
      {
        onSuccess: (result) => {
          setNewToken(chosen.length > 0 ? null : result.token);
          if (chosen.length > 0) generateDialog.onClose();
          setDescription("");
          setConnectionId("");
          setSecret("");
          refresh();
        },
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Couldn't issue the provisioning token" }),
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
          refresh();
        },
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Couldn't revoke the provisioning token" }),
      },
    );
  };

  return {
    list,
    connections,
    labelFor,
    issuableConnections,
    hasIssuableConnection: issuableConnections.length > 0,
    chosenConnectionId,
    isGenerateOpen: generateDialog.open,
    onGenerateOpen: generateDialog.onOpen,
    onGenerateClose: generateDialog.onClose,
    description,
    setDescription,
    setConnectionId,
    secret,
    setSecret,
    newToken,
    setNewToken,
    tokenToRevoke,
    setTokenToRevoke,
    generateMutation,
    revokeMutation,
    handleGenerate,
    handleRevoke,
  };
}

type ScimTokens = ReturnType<typeof useScimTokens>;

function TokenDialogs({ tokens }: { tokens: ScimTokens }) {
  return (
    <>
      <GenerateTokenDialog tokens={tokens} />

      <Dialog.Root
        open={!!tokens.newToken}
        onOpenChange={({ open }) => {
          if (!open) {
            tokens.setNewToken(null);
            tokens.onGenerateClose();
          }
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Token issued
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text color="orange.500" fontWeight="600">
                Copy this token now. It is shown once and never again.
              </Text>
              {tokens.newToken && <CopyInput value={tokens.newToken} label="Provisioning token" />}
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={!!tokens.tokenToRevoke}
        onOpenChange={({ open }) => {
          if (!open) tokens.setTokenToRevoke(null);
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Revoke this token?
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                The identity provider using it stops being able to provision anyone through this
                connection, immediately.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button variant="outline" onClick={() => tokens.setTokenToRevoke(null)}>
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() => tokens.tokenToRevoke && tokens.handleRevoke(tokens.tokenToRevoke)}
                  disabled={tokens.revokeMutation.isPending}
                  data-testid="scim-token-revoke-confirm"
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

function GenerateTokenDialog({ tokens }: { tokens: ScimTokens }) {
  const hasSecret = tokens.secret.trim().length > 0;
  const held = !tokens.hasIssuableConnection || !tokens.chosenConnectionId;

  return (
    <Dialog.Root
      open={tokens.isGenerateOpen && !tokens.newToken}
      onOpenChange={({ open }) => {
        if (!open) {
          tokens.onGenerateClose();
          tokens.setDescription("");
          tokens.setConnectionId("");
          tokens.setSecret("");
        }
      }}
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Issue a provisioning token
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text>
              This token manages the people its connection provisioned, and can take on members no
              directory has claimed yet, so choose the connection your identity provider syncs from.
            </Text>
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Connection
              </Text>
              {tokens.hasIssuableConnection ? (
                <NativeSelect.Root>
                  <NativeSelect.Field
                    aria-label="Connection"
                    data-testid="scim-connection-select"
                    value={tokens.chosenConnectionId}
                    onChange={(event) => tokens.setConnectionId(event.target.value)}
                  >
                    <option value="">Choose a connection</option>
                    {tokens.issuableConnections.map((option) => (
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
                      Finish setting up and activate an identity provider connection before issuing
                      a directory sync token.
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
                aria-label="Description"
                placeholder="For example, Okta production"
                data-testid="scim-token-description"
                value={tokens.description}
                onChange={(event) => tokens.setDescription(event.target.value)}
              />
            </VStack>
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Token
              </Text>
              <Input
                aria-label="Token"
                type="password"
                placeholder="Leave empty and we will generate one"
                value={tokens.secret}
                onChange={(event) => tokens.setSecret(event.target.value)}
              />
              <Text color="fg.muted" fontSize="xs">
                {hasSecret
                  ? "We store only a hash of it, the same as one we generate. It cannot be read back."
                  : "Paste the value from your identity provider if it already has one, or leave this empty."}
              </Text>
            </VStack>
            <Button
              width="full"
              onClick={tokens.handleGenerate}
              disabled={tokens.generateMutation.isPending || held}
              data-testid="scim-generate-submit"
            >
              {hasSecret ? "Save token" : "Generate token"}
            </Button>
            {!tokens.generateMutation.isPending && held && (
              <Text color="fg.muted" fontSize="xs">
                {tokens.hasIssuableConnection
                  ? "Choose which connection this token provisions for, above."
                  : "A token provisions people for one single sign-on connection, so there has to be a live one first."}
              </Text>
            )}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
