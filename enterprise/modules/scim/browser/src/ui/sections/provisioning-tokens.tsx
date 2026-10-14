import { Link } from "@langwatch/browser-host/link";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
import { Banner } from "@langwatch/design-system/banner";
import { Dialog } from "@langwatch/design-system/dialog";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The provisioning tokens an organization holds, and the two acts on them.
 * A token is bound to one connection and manages only the people that
 * connection provisioned, so only live connections are offered: a token
 * issued against a draft or a torn-down one authenticates and syncs nobody.
 * Shown once when issued; unrecoverable after the dialog closes.
 */
import {
  Badge,
  Button,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { scimApi } from "../../behavior/scim-api.ts";
import { chosenConnectionOf, isActiveConnection } from "../../model/connection-lifecycle.ts";
import { connectionLabel } from "../../model/display-formatters.ts";
import { isEnterpriseGateError } from "../../model/enterprise-gate.ts";
import { useScimHost } from "../../model/scim-host.ts";
import { CopyInput } from "../elements/copy-input.tsx";

const HELD_REASON = {
  choose: "Choose which connection this token provisions for.",
  none: "Finish setting up a single sign-on connection first.",
} as const;
const SCIM_DOCS_URL = "https://docs.langwatch.ai/platform/scim";

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
          <Heading textStyle="cardTitle">Provisioning tokens</Heading>
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

      {(list.isError || connections.isError) &&
        isEnterpriseGateError(list.error ?? connections.error) && (
          <UpgradeRequired
            feature="Directory sync"
            data-testid="scim-enterprise-gate"
            actions={
              <Button asChild colorPalette="orange" size="sm">
                <Link href="/settings/plans">Compare plans</Link>
              </Button>
            }
          />
        )}
      {(list.isError || connections.isError) &&
        !isEnterpriseGateError(list.error ?? connections.error) && (
          <HandledErrorAlert
            error={list.error ?? connections.error}
            fallbackTitle="We couldn't load your provisioning tokens"
            onRetry={() => {
              void list.refetch();
              void connections.refetch();
            }}
          />
        )}

      <ListTable scroll="x" scrollLabel="Provisioning tokens table">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Description</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Connection</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Issued</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
            {mayManage && <ListTable.ActionHeader label="Revoke" />}
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {!list.isError && list.data?.length === 0 && (
            <ListTable.EmptyRow
              columns={mayManage ? 5 : 4}
              state="empty"
              title="No provisioning token has been issued yet"
              next={[{ kind: "docs", label: "How provisioning works", href: SCIM_DOCS_URL }]}
            />
          )}
          {list.data?.map((token) => (
            <ListTable.Row key={token.id}>
              <ListTable.Cell>
                <HStack>
                  <Key size={14} />
                  <Text>{token.description ?? "No description"}</Text>
                </HStack>
              </ListTable.Cell>
              <ListTable.Cell>
                {token.connectionId ? (
                  <Text>{labelFor(token.connectionId)}</Text>
                ) : (
                  <Badge size="sm" colorPalette="gray">
                    Every connection
                  </Badge>
                )}
              </ListTable.Cell>
              <ListTable.Cell>
                <FormattedDate value={token.createdAt} display="date" />
              </ListTable.Cell>
              <ListTable.Cell>
                {token.lastUsedAt ? (
                  <FormattedDate value={token.lastUsedAt} display="date" />
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
              </ListTable.Cell>
              {mayManage && (
                <ListTable.ActionCell>
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
                </ListTable.ActionCell>
              )}
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>

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

      <Dialog
        open={!!tokens.newToken}
        onClose={() => {
          tokens.setNewToken(null);
          tokens.onGenerateClose();
        }}
        size="md"
        title="Token issued"
        cancelLabel={null}
        closeOnInteractOutside={false}
      >
        <VStack gap={4} align="start">
          <Text color="fg.warning" fontWeight="medium">
            Copy this token now. It is shown once and never again.
          </Text>
          {tokens.newToken && <CopyInput value={tokens.newToken} label="Provisioning token" />}
        </VStack>
      </Dialog>

      <Dialog
        open={!!tokens.tokenToRevoke}
        onClose={() => tokens.setTokenToRevoke(null)}
        size="md"
        title="Revoke this token?"
        primaryAction={{
          label: "Revoke",
          onClick: () => tokens.tokenToRevoke && tokens.handleRevoke(tokens.tokenToRevoke),
          loading: tokens.revokeMutation.isPending,
          danger: true,
          "data-testid": "scim-token-revoke-confirm",
        }}
      >
        <VStack gap={4} align="start">
          <Text>
            The identity provider using it stops being able to provision anyone through this
            connection, immediately.
          </Text>
        </VStack>
      </Dialog>
    </>
  );
}

function GenerateTokenDialog({ tokens }: { tokens: ScimTokens }) {
  const hasSecret = tokens.secret.trim().length > 0;
  const held = !tokens.hasIssuableConnection || !tokens.chosenConnectionId;
  const heldReason = held ? HELD_REASON[tokens.hasIssuableConnection ? "choose" : "none"] : void 0;

  const closeGenerate = () => {
    tokens.onGenerateClose();
    tokens.setDescription("");
    tokens.setConnectionId("");
    tokens.setSecret("");
  };

  return (
    <Dialog
      open={tokens.isGenerateOpen && !tokens.newToken}
      onClose={closeGenerate}
      size="md"
      title="Issue a provisioning token"
      primaryAction={{
        label: hasSecret ? "Save token" : "Generate token",
        onClick: tokens.handleGenerate,
        loading: tokens.generateMutation.isPending,
        disabledReason: heldReason,
        "data-testid": "scim-generate-submit",
      }}
    >
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
            <Banner status="info" title="Waiting for single sign-on">
              Finish setting up and activate an identity provider connection before issuing a
              directory sync token.
            </Banner>
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
        {!tokens.generateMutation.isPending && held && (
          <Text color="fg.muted" fontSize="xs">
            {tokens.hasIssuableConnection
              ? "Choose which connection this token provisions for, above."
              : "A token provisions people for one single sign-on connection, so there has to be a live one first."}
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}
