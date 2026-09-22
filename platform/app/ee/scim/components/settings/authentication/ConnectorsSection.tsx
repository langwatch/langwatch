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
import { ScimReconciliationPanel } from "@ee/scim/components/settings/ScimReconciliationPanel";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DirectoryMembersSection } from "~/components/access/DirectoryMembersSection";
import { CopyInput } from "~/components/CopyInput";
import { CopyValueRows } from "~/components/settings/CopyValueRows";
import { SettingsDisclosure } from "~/components/settings/SettingsDisclosure";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { isActiveConnection } from "~/features/directory/logic/connectionLifecycle";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { api, type RouterOutputs } from "~/utils/api";

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
          one single sign-on connection: it manages the people that connection
          provisioned, and can take on members no directory has claimed yet.
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
  const tokensState = useScimTokens({ organizationId });
  const { tokens, connections, labelFor, setTokenToRevoke, onGenerateOpen } =
    tokensState;

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
          reach us. Set the one your provider already has, or let us generate
          one, and give it the provisioning address.
        </Text>
        <SettingsDisclosure summary="What a token can do, and what revoking one stops">
          <Text color="fg.muted" fontSize="sm" maxWidth="80ch">
            From then on the provider can create, update and remove people in
            this organization on its own — nobody signs in to do it. Each token
            works against one single sign-on connection: it manages the people
            that connection provisioned, and can take on members no directory
            has claimed yet — members somebody invited by hand, for instance. It
            never reaches people another connection provisioned, and revoking it
            stops exactly that provider and nothing else. The value is shown
            once when it is issued; if it is lost or leaked, revoke it and issue
            another.
          </Text>
        </SettingsDisclosure>
      </VStack>

      {/* A read that failed is not a table with nothing in it. Without this the
          section renders a bare header — indistinguishable from "no tokens
          issued" — and the dialog goes on to claim no connection is live when
          the connection list merely could not be loaded. */}
      {(tokens.isError || connections.isError) && (
        <HandledErrorAlert
          error={tokens.error ?? connections.error}
          fallbackTitle="We couldn't load your provisioning tokens"
          onRetry={() => {
            void tokens.refetch();
            void connections.refetch();
          }}
        />
      )}

      <ScimTokensTable
        tokens={tokens}
        mayManage={mayManage}
        labelFor={labelFor}
        onRevoke={setTokenToRevoke}
      />

      <ScimTokenDialogs tokens={tokensState} mayManage={mayManage} />
    </>
  );
}

/**
 * Which connection the token will be issued against.
 *
 * With exactly ONE to choose from, the choice is already made and asking is an
 * errand: the picker would offer a list of one and refuse the mint until
 * somebody picked the only option on it. With several, nothing is assumed — a
 * token issued against the wrong connection has the wrong write authority, and
 * guessing that is worse than asking.
 */
function chosenConnectionOf({
  connectionId,
  issuableConnections,
}: {
  connectionId: string;
  issuableConnections: { connectionId: string }[];
}): string {
  if (connectionId) return connectionId;
  if (issuableConnections.length !== 1) return "";
  return issuableConnections[0]?.connectionId ?? "";
}

/**
 * The provisioning tokens an organization holds, and the two acts on them.
 *
 * A token is bound to ONE connection and can only touch the people that
 * connection provisioned, so only connections that could carry it are
 * offered — a token issued against a draft, a rejected claim or a torn-down
 * connection authenticates perfectly and syncs nobody, which is a dead end
 * discovered at the provider rather than here.
 */
function useScimTokens({ organizationId }: { organizationId: string }) {
  const tokens = api.scimToken.list.useQuery({ organizationId });
  const connections = api.scimReconciliation.getAll.useQuery({
    organizationId,
  });

  const generateMutation = api.scimToken.generate.useMutation();
  const revokeMutation = api.scimToken.revoke.useMutation();

  const {
    open: isGenerateOpen,
    onOpen: onGenerateOpen,
    onClose: onGenerateClose,
  } = useDisclosure();

  const [description, setDescription] = useState("");
  const [connectionId, setConnectionId] = useState("");
  /** A value the administrator already has. Empty means "mint one for me". */
  const [secret, setSecret] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const connectionOptions = connections.data?.connections ?? [];
  const labelFor = (id: string | null) =>
    connectionOptions.find((option) => option.connectionId === id)
      ?.providerId ?? id;
  /**
   * ONLY THE ONES THAT COULD CARRY IT. A token is bound to one connection and
   * can only touch the people that connection provisioned, so a token issued
   * against a draft, a rejected claim or a torn-down connection provisions
   * nobody. Offering those was offering a dead end that authenticates
   * perfectly and syncs nothing, discovered at the provider rather than here.
   *
   * The table below still resolves names from the full list: a token whose
   * connection has since been retired is exactly the row whose name a reader
   * needs, and drawing it as a bare identifier would be the worse half.
   */
  const issuableConnections = connectionOptions.filter(isActiveConnection);
  const hasIssuableConnection = issuableConnections.length > 0;
  const chosenConnectionId = chosenConnectionOf({
    connectionId,
    issuableConnections,
  });

  const { handleGenerate, handleRevoke } = useScimTokenActions({
    organizationId,
    chosenConnectionId,
    description,
    secret,
    generateMutation,
    revokeMutation,
    onGenerateClose,
    setNewToken,
    setDescription,
    setConnectionId,
    setSecret,
    setTokenToRevoke,
  });

  return {
    tokens,
    connections,
    connectionOptions,
    labelFor,
    issuableConnections,
    hasIssuableConnection,
    chosenConnectionId,
    isGenerateOpen,
    onGenerateOpen,
    onGenerateClose,
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

/**
 * The tokens an organization holds, one row each.
 *
 * Names resolve from the FULL connection list, not the issuable one: a token
 * whose connection has since been retired is exactly the row whose name a
 * reader needs, and drawing it as a bare identifier would be the worse half.
 */
function ScimTokensTable({
  tokens,
  mayManage,
  labelFor,
  onRevoke,
}: {
  tokens: {
    data: RouterOutputs["scimToken"]["list"] | undefined;
    isError: boolean;
    error: unknown;
  };
  mayManage: boolean;
  labelFor: (id: string | null) => string | null;
  onRevoke: (tokenId: string) => void;
}) {
  return (
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
            {!tokens.isError && tokens.data?.length === 0 && (
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
                    // THE ONE ANSWER AVAILABLE for the most common setup
                    // failure there is (ADR-126). A request carrying a token
                    // we do not recognise cannot be attributed to anybody —
                    // a SCIM token is an opaque value looked up by hash, so
                    // there is no organization to file a mistyped one under
                    // and it can never appear in the request list. This
                    // badge is the whole remedy, so it says what it means
                    // instead of leaving a reader to infer it from a date
                    // that is missing, and it points at the provider rather
                    // than at us.
                    <VStack align="start" gap={0}>
                      <Badge size="sm" colorPalette="gray">
                        Never
                      </Badge>
                      <Text fontSize="xs" color="fg.muted">
                        Nothing has presented this token yet. If your identity
                        provider says it is syncing, check the token it is
                        using.
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
                      aria-label={`Revoke ${token.description ?? "token"}`}
                      onClick={() => onRevoke(token.id)}
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
  );
}

/**
 * Minting a token and revoking one — the two dialogs the tokens table opens.
 *
 * A value the administrator ALREADY HAS needs no "copy this now" ceremony, so
 * only a generated one gets the reveal step; a supplied one closes straight
 * away.
 */
function ScimTokenDialogs({
  tokens,
  mayManage,
}: {
  tokens: ReturnType<typeof useScimTokens>;
  mayManage: boolean;
}) {
  if (!mayManage) return null;
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
              {tokens.newToken && (
                <CopyInput value={tokens.newToken} label="Provisioning token" />
              )}
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
                The identity provider using it stops being able to provision
                anyone through this connection, immediately.
              </Text>
              <HStack width="full" justify="end" gap={2}>
                <Button
                  variant="outline"
                  onClick={() => tokens.setTokenToRevoke(null)}
                >
                  Cancel
                </Button>
                <Button
                  colorPalette="red"
                  onClick={() =>
                    tokens.tokenToRevoke &&
                    tokens.handleRevoke(tokens.tokenToRevoke)
                  }
                  disabled={tokens.revokeMutation.isPending}
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

/**
 * Minting and revoking, as the two mutations plus what each leaves behind.
 *
 * A supplied value closes the dialog straight away; a generated one stays open
 * on the reveal, because it is the only moment the token is readable.
 */
function useScimTokenActions({
  organizationId,
  chosenConnectionId,
  description,
  secret,
  generateMutation,
  revokeMutation,
  onGenerateClose,
  setNewToken,
  setDescription,
  setConnectionId,
  setSecret,
  setTokenToRevoke,
}: {
  organizationId: string;
  chosenConnectionId: string;
  description: string;
  secret: string;
  generateMutation: ReturnType<typeof api.scimToken.generate.useMutation>;
  revokeMutation: ReturnType<typeof api.scimToken.revoke.useMutation>;
  onGenerateClose: () => void;
  setNewToken: React.Dispatch<React.SetStateAction<string | null>>;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  setConnectionId: React.Dispatch<React.SetStateAction<string>>;
  setSecret: React.Dispatch<React.SetStateAction<string>>;
  setTokenToRevoke: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const queryClient = api.useUtils();
  const handleGenerate = () => {
    const chosen = secret.trim();
    generateMutation.mutate(
      {
        organizationId,
        connectionId: chosenConnectionId || undefined,
        description: description || undefined,
        secret: chosen.length > 0 ? chosen : undefined,
      },
      {
        onSuccess: (result) => {
          // A value the administrator already had needs no "copy this now"
          // ceremony — they have it. Only a generated one does.
          setNewToken(chosen.length > 0 ? null : result.token);
          if (chosen.length > 0) onGenerateClose();
          setDescription("");
          setConnectionId("");
          setSecret("");
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

  return { handleGenerate, handleRevoke };
}

/**
 * Minting a token, with the connection it will be bound to.
 *
 * With exactly ONE issuable connection the choice is already made and asking
 * is an errand; with several, nothing is assumed — a token issued against the
 * wrong connection has the wrong write authority, and guessing that is worse
 * than asking.
 */
function GenerateTokenDialog({
  tokens,
}: {
  tokens: ReturnType<typeof useScimTokens>;
}) {
  return (
    <Dialog.Root
      open={tokens.isGenerateOpen && !tokens.newToken}
      onOpenChange={({ open }) => {
        if (!open) {
          tokens.onGenerateClose();
          tokens.setDescription("");
          tokens.setConnectionId("");
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
              This token manages the people its connection provisioned, and can
              take on members no directory has claimed yet — so choose the
              connection your identity provider syncs from.
            </Text>
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Connection
              </Text>
              {tokens.hasIssuableConnection ? (
                <NativeSelect.Root>
                  <NativeSelect.Field
                    aria-label="Connection"
                    value={tokens.chosenConnectionId}
                    onChange={(event) =>
                      tokens.setConnectionId(event.target.value)
                    }
                  >
                    <option value="">Choose a connection</option>
                    {tokens.issuableConnections.map((option) => (
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
              ) : (
                <Alert.Root status="info" role="status">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Waiting for single sign-on</Alert.Title>
                    <Alert.Description>
                      Finish setting up and activate an identity provider
                      connection before issuing a directory sync token.
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
                value={tokens.description}
                onChange={(event) => tokens.setDescription(event.target.value)}
              />
            </VStack>
            {/* EITHER DIRECTION, BECAUSE THE USUAL ONE IS THE OTHER WAY.
                Somebody configuring an identity provider is usually
                standing in the provider's console with the value already
                decided; making them come here, take ours, and go back and
                paste it is an errand we invented. What matters is only that
                the two ends match.

                Ours stays the default, because a value we generate is
                long and random and a typed one might not be. */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Token
              </Text>
              <HStack width="full" gap={2}>
                <Input
                  aria-label="Token"
                  type="password"
                  placeholder="Leave empty and we will generate one"
                  value={tokens.secret}
                  onChange={(event) => tokens.setSecret(event.target.value)}
                />
              </HStack>
              <Text color="fg.muted" fontSize="xs">
                {tokens.secret.trim().length > 0
                  ? "We store only a hash of it, the same as one we generate. It cannot be read back."
                  : "Paste the value from your identity provider if it already has one, or leave this empty."}
              </Text>
            </VStack>
            <Button
              width="full"
              onClick={tokens.handleGenerate}
              // `connectionId` is the placeholder until one is chosen, and
              // submitting without it is refused by the service as
              // `scim_connection_required` — a rejection the reader could
              // see coming, arriving as a toast. The control is held instead,
              // and the line below says which of the two reasons it is.
              disabled={
                tokens.generateMutation.isPending ||
                !tokens.hasIssuableConnection ||
                !tokens.chosenConnectionId
              }
            >
              {tokens.secret.trim().length > 0
                ? "Save token"
                : "Generate token"}
            </Button>
            {/* A GREYED BUTTON WITH NO SENTENCE IS A DEAD END. The reader is
                looking at the one control the dialog exists for, refusing to
                be pressed and saying nothing — so they cannot tell whether
                they have missed a field, hit a permission, or found a bug.
                Not rendered while the mutation runs: the button is already
                showing that, and a reason underneath would read as a fault. */}
            {!tokens.generateMutation.isPending &&
              (!tokens.hasIssuableConnection || !tokens.chosenConnectionId) && (
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
