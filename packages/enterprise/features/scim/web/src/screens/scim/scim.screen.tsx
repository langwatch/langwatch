/**
 * SCIM provisioning, at `/settings/scim`.
 *
 * TWO THINGS AN IDENTITY PROVIDER NEEDS: the base URL it posts to, and a bearer
 * token to authenticate with. Okta, Entra ID and the rest then create and
 * deactivate people in LangWatch without anybody inviting them by hand.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE. `generate` is the only answer that carries
 * the plaintext; the list answers metadata and never a secret, so the minted
 * key lives in local state until its dialog closes and is then unrecoverable —
 * which is what the copy on that dialog says out loud.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

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
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { scimApi } from "../../behavior/scim-api";
import { useScimHost } from "../../model/scim-host";
import { CopyInput } from "../../ui/elements/copy-input";

/** The grant the platform page asked for, unchanged. */
export const SCIM_PAGE_PERMISSION = "organization:manage";

export default function ScimScreen() {
  const organizationId = useScimHost().organizationId();

  if (!organizationId) return null;

  return <ScimSettingsContent organizationId={organizationId} />;
}

function ScimSettingsContent({ organizationId }: { organizationId: string }) {
  const host = useScimHost();
  const tokens = scimApi.scimToken.list.useQuery({ organizationId });
  const generateMutation = scimApi.scimToken.generate.useMutation();
  const revokeMutation = scimApi.scimToken.revoke.useMutation();
  const queryClient = scimApi.useUtils();

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
        <HStack width="full">
          <Heading>SCIM Provisioning</Heading>
          <Spacer />
        </HStack>

        <Card.Root width="full">
          <Card.Body>
            <VStack gap={4} align="start">
              <Text>
                SCIM (System for Cross-domain Identity Management) allows your identity
                provider (Okta, Azure AD, etc.) to automatically provision and deprovision
                users in LangWatch.
              </Text>

              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600">SCIM Base URL</Text>
                <CopyInput value={scimBaseUrl} label="SCIM Base URL" />
              </VStack>

              <Text fontSize="sm" color="gray.500">
                Use this URL and a bearer token below to configure SCIM in your identity
                provider.
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
                This token will be used by your identity provider to authenticate SCIM
                requests.
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
                disabled={generateMutation.isPending}
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
                Are you sure you want to revoke this token? Any identity provider using it
                will no longer be able to provision users.
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
