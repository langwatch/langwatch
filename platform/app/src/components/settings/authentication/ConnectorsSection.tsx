import {
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
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DirectoryMembersSection } from "~/components/access/DirectoryMembersSection";
import { CopyInput } from "~/components/CopyInput";
import { CopyValueRows } from "~/components/settings/CopyValueRows";
import { ScimReconciliationPanel } from "~/components/settings/ScimReconciliationPanel";
import { SettingsDisclosure } from "~/components/settings/SettingsDisclosure";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

/**
 * What the directory has been doing, who it did it to, and where it should
 * send the next one.
 *
 *   connections ──► the people they manage ──► the address to point at
 *                                              ──► the token to point with
 *
 * The order is the reader's own question narrowing: is it working, is it
 * working on the right people, and — only if they are still setting it up —
 * what do I paste into the identity provider. The people sit in the middle
 * because they are what the connections above them are FOR, and they are the
 * one thing the status band can count but cannot show.
 *
 * The address and the token are one errand and are now on one tab. They were
 * two, so an administrator halfway through configuring a provider had to copy
 * a value, change tab, and come back for the other half.
 */
export function ConnectorsOverview({
  organizationId,
  mayReadMembership,
  maySetUpSingleSignOn,
}: {
  organizationId: string;
  /** `organization:manage`: the roster and the provenance that names it. */
  mayReadMembership: boolean;
  /** `sso:manage`: whether the empty state carries the first step. */
  maySetUpSingleSignOn: boolean;
}) {
  const scimBaseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/scim/v2`
      : "";

  return (
    <VStack gap={6} width="full" align="stretch">
      <ScimReconciliationPanel
        organizationId={organizationId}
        maySetUpSingleSignOn={maySetUpSingleSignOn}
      />

      {/* Absent rather than empty for a reader who may not have it: a roster
          they cannot read is not a roster with nobody in it, and the band
          above already says so in words where the counts would be. */}
      {mayReadMembership && (
        <DirectoryMembersSection organizationId={organizationId} />
      )}

      <VStack gap={2} align="stretch" width="full">
        <Heading size="sm">Where your identity provider sends it</Heading>
        {/* THE PROTOCOL, NAMED. The navigation entry says Directory because
            that is what the page holds, but an IT administrator arrives here
            having searched for SCIM — and this address is the SCIM endpoint,
            so this is the honest place for the word rather than a sentence
            about it under the page title. */}
        <Text color="fg.muted" fontSize="sm">
          Your identity provider talks to us over SCIM. Each token works against
          one single sign-on connection and only manages the people that
          connection provisioned.
        </Text>
        <CopyValueRows
          rows={[
            {
              label: "Provisioning address",
              hint: "Paste this into your identity provider, with a token from below",
              value: scimBaseUrl,
            },
          ]}
        />
      </VStack>
    </VStack>
  );
}

export function TokensSection({
  organizationId,
  mayManage,
}: {
  organizationId: string;
  mayManage: boolean;
}) {
  const tokens = api.scimToken.list.useQuery({ organizationId });
  const connections = api.scimReconciliation.getAll.useQuery({
    organizationId,
  });
  const queryClient = api.useUtils();

  const generateMutation = api.scimToken.generate.useMutation();
  const revokeMutation = api.scimToken.revoke.useMutation();

  const {
    open: isGenerateOpen,
    onOpen: onGenerateOpen,
    onClose: onGenerateClose,
  } = useDisclosure();

  const [description, setDescription] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const connectionOptions = connections.data?.connections ?? [];
  const labelFor = (id: string | null) =>
    connectionOptions.find((option) => option.connectionId === id)
      ?.providerId ?? id;

  const handleGenerate = () => {
    generateMutation.mutate(
      {
        organizationId,
        connectionId: connectionId || undefined,
        description: description || undefined,
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setDescription("");
          setConnectionId("");
          void queryClient.scimToken.list.invalidate();
          void queryClient.scimReconciliation.invalidate();
        },
        onError: (error) => {
          // The wire message for a handled error IS its code, so the words
          // come from the code-keyed registry — a token minted without a
          // connection has copy that names the field to fill in.
          showErrorToast({
            error,
            fallbackTitle: "Couldn't issue the provisioning token",
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
          });
          void queryClient.scimToken.list.invalidate();
          void queryClient.scimReconciliation.invalidate();
        },
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: "Couldn't revoke the provisioning token",
          });
        },
      },
    );
  };

  return (
    <>
      <VStack width="full" align="stretch" gap={2}>
        <HStack width="full">
          {/* `sm`, like every other section heading on this page and on the
              panels beside it. `md` made the Tokens tab read as a level above
              the tabs it sits under. */}
          <Heading size="sm">Provisioning tokens</Heading>
          <Spacer />
          {mayManage && (
            <Button size="sm" onClick={onGenerateOpen}>
              <Plus size={16} />
              Issue token
            </Button>
          )}
        </HStack>
        {/* WHAT THE THING IS, BEFORE THE TABLE OF THEM. "Provisioning token"
            names a mechanism to somebody who already knows it and nothing at
            all to anybody else, and the page below it went straight to
            descriptions and last-used dates.

            One sentence of it, though. The nine-line paragraph that used to
            stand here answered every question at once, above a table somebody
            had come to read — so it stopped being help and became the wall
            they crossed to reach the page. What is left says what a token IS
            and what to do with it; the rest is a fold below. */}
        <Text color="fg.muted" fontSize="sm" maxWidth="80ch">
          A provisioning token is the password your identity provider uses to
          reach us. Issue one here and paste it into the provider alongside the
          provisioning address.
        </Text>
        <SettingsDisclosure summary="What a token can do, and what revoking one stops">
          <Text color="fg.muted" fontSize="sm" maxWidth="80ch">
            From then on the provider can create, update and remove people in
            this organization on its own — nobody signs in to do it. Each token
            works against one single sign-on connection and can only touch the
            people that connection provisioned, so revoking one stops exactly
            that provider and nothing else. The value is shown once when it is
            issued; if it is lost or leaked, revoke it and issue another.
          </Text>
        </SettingsDisclosure>
      </VStack>

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
              {tokens.data?.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={mayManage ? 5 : 4}>
                    <Text color="fg.muted" textAlign="center" paddingY={4}>
                      No provisioning token has been issued yet.
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
                    {token.connectionId ? (
                      <Text>{labelFor(token.connectionId)}</Text>
                    ) : (
                      // Issued before a token named a connection, so it keeps
                      // the organization-wide reach it was sold with. Said
                      // plainly rather than left blank: it is the one row on
                      // this table whose authority is wider than the others.
                      <Badge size="sm" colorPalette="gray">
                        Every connection
                      </Badge>
                    )}
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
                  {mayManage && (
                    <Table.Cell>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
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
              <Heading size="md">Issue a provisioning token</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                This token manages only the people its connection provisioned,
                so choose the connection your identity provider syncs from.
              </Text>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Connection
                </Text>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    aria-label="Connection"
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                  >
                    <option value="">Choose a connection</option>
                    {connectionOptions.map((option) => (
                      <option
                        key={option.connectionId}
                        value={option.connectionId}
                      >
                        {option.providerId}
                        {option.verifiedDomains.length > 0
                          ? ` — ${option.verifiedDomains.join(", ")}`
                          : ""}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </VStack>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Description (optional)
                </Text>
                <Input
                  aria-label="Description"
                  placeholder="For example, Okta production"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </VStack>
              <Button
                width="full"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                Issue token
              </Button>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

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
              <Heading size="md">Token issued</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text color="orange.500" fontWeight="600">
                Copy this token now. It is shown once and never again.
              </Text>
              {newToken && (
                <CopyInput value={newToken} label="Provisioning token" />
              )}
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={!!tokenToRevoke}
        onOpenChange={({ open }) => {
          if (!open) setTokenToRevoke(null);
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>
              <Heading size="md">Revoke this token?</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack gap={4} align="start">
              <Text>
                The identity provider using it stops being able to provision
                anyone through this connection, immediately.
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
