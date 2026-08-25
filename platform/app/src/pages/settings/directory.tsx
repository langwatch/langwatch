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
  Tabs,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { DirectoryMembersSection } from "../../components/access/DirectoryMembersSection";
import { DirectorySummary } from "../../components/access/DirectorySummary";
import { GroupsSection } from "../../components/access/GroupsSection";
import { CopyInput } from "../../components/CopyInput";
import { PermissionAlert } from "../../components/PermissionAlert";
import SettingsLayout from "../../components/SettingsLayout";
import { CopyValueRows } from "../../components/settings/CopyValueRows";
import { ScimReconciliationPanel } from "../../components/settings/ScimReconciliationPanel";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../../components/ui/toaster";
import { showErrorToast } from "../../features/errors";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

/**
 * The Directory: who an identity provider provisions here, and the groups it
 * sends (D08 + ADR-122).
 *
 * NAMED FOR WHAT IT HOLDS, NOT FOR THE PROTOCOL THAT FILLS IT. The navigation
 * entry says Directory, because "SCIM" is a thing an IT administrator has
 * heard of and everybody else has not. The word survives in the body copy, so
 * the administrator who searches for the protocol still lands here.
 *
 * STATUS LEADS, AND STANDS ABOVE THE TABS. Which sources are connected, when
 * the last push landed, how many people the directory manages, how many
 * groups it sent, and how many members it does NOT manage: those five are the
 * reason anybody opens this page, and every tab under them is what to do
 * about the answer. Putting the band inside a tab would hide the question
 * from two thirds of the page.
 *
 * THREE TABS, ONE SUBJECT.
 *
 *   Overview ─ what the directory has been doing, per connection, and where
 *              it should send it
 *   Groups ─── every group in the organization, the sent ones and the
 *              hand-made ones alike
 *   Tokens ─── the write authority each connection syncs with
 *
 * Groups used to be a navigation entry of its own, one click away from the
 * page that reports whether the directory sent the group in question. They
 * are one subject and they are one page now; the old address forwards onto
 * the tab.
 *
 * TWO PERMISSIONS, TWO JOBS, AND NEITHER IS THE WHOLE PAGE. Reading what a
 * directory did takes `sso:view` — the D05 "see single sign-on" permission —
 * because it is a security reviewer's job. Managing groups takes
 * `organization:manage`. A reader holding either gets the page with the tabs
 * they may open and no others, rather than the page refusing them outright
 * for lacking the half they did not come for. Issuing and revoking a token
 * takes `sso:manage`: a reader without it is offered no control at all, since
 * a disabled button is still an invitation, and inviting somebody to do a
 * thing they will be refused for is worse than not offering it.
 *
 * A TOKEN NAMES ITS CONNECTION. There is no way to mint one without choosing,
 * because the connection IS the token's write authority and defaulting it
 * would hand out authority nobody asked for.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function DirectorySettings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return <DirectorySettingsContent organizationId={organization.id} />;
}

const TABS = ["overview", "groups", "tokens"] as const;
type DirectoryTab = (typeof TABS)[number];

/** What the reader may open here. */
interface DirectoryReach {
  /** `sso:view`: the status band, the connection detail and the tokens. */
  maySeeSync: boolean;
  /** `organization:manage`: the groups, and the counts that read membership. */
  mayManageGroups: boolean;
}

/**
 * The tab actually opened, given what the address asked for and what the
 * reader may have.
 *
 * A tab a reader may not open never becomes the open one, however the address
 * arrived — a link a colleague pasted, a bookmark, or the old groups address
 * forwarding onto its tab. Pure, so the decision can be read in one place
 * rather than inferred from three conditionals around a `<Tabs.Root>`.
 */
export function resolveDirectoryTab({
  requested,
  maySeeSync,
  mayManageGroups,
}: DirectoryReach & { requested: string | null }): DirectoryTab {
  const asked: DirectoryTab = TABS.includes(requested as DirectoryTab)
    ? (requested as DirectoryTab)
    : "overview";
  const mayOpen = asked === "groups" ? mayManageGroups : maySeeSync;
  if (mayOpen) return asked;
  return maySeeSync ? "overview" : "groups";
}

function DirectorySettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const reach: DirectoryReach = {
    maySeeSync: hasPermission("sso:view"),
    mayManageGroups: hasPermission("organization:manage"),
  };
  const mayManageTokens = hasPermission("sso:manage");

  // Which tab is open lives in the address, so "the group you mapped is
  // here" is a link that opens on the groups rather than on the status.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveDirectoryTab({
    requested: searchParams.get("tab"),
    ...reach,
  });

  const selectTab = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        // Overview is the default, so it stays out of the address entirely.
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  if (!reach.maySeeSync && !reach.mayManageGroups) {
    return (
      <SettingsLayout>
        <PermissionAlert permission="sso:view" />
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1} width="full">
          <Heading>Directory</Heading>
          <Text color="fg.muted" fontSize="sm">
            Your identity provider creates, updates and removes people here on
            its own, over SCIM.
          </Text>
        </VStack>

        {reach.maySeeSync && (
          <DirectorySummary
            organizationId={organizationId}
            canReadMembership={reach.mayManageGroups}
          />
        )}

        <Tabs.Root
          value={tab}
          onValueChange={(event) => selectTab(event.value)}
          colorPalette="blue"
          width="full"
        >
          <Tabs.List marginBottom={4}>
            {reach.maySeeSync && (
              <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
            )}
            {reach.mayManageGroups && (
              <Tabs.Trigger value="groups">Groups</Tabs.Trigger>
            )}
            {reach.maySeeSync && (
              <Tabs.Trigger value="tokens">Tokens</Tabs.Trigger>
            )}
          </Tabs.List>

          {reach.maySeeSync && (
            <Tabs.Content value="overview">
              <OverviewTab
                organizationId={organizationId}
                mayReadMembership={reach.mayManageGroups}
                maySetUpSingleSignOn={mayManageTokens}
              />
            </Tabs.Content>
          )}

          {reach.mayManageGroups && (
            <Tabs.Content value="groups">
              <GroupsSection organizationId={organizationId} canManage={true} />
            </Tabs.Content>
          )}

          {reach.maySeeSync && (
            <Tabs.Content value="tokens">
              {/* TokensSection is a fragment of stacked blocks, so the tab
                  supplies the column that spaces them. */}
              <VStack gap={4} width="full" align="start">
                <TokensSection
                  organizationId={organizationId}
                  mayManage={mayManageTokens}
                />
              </VStack>
            </Tabs.Content>
          )}
        </Tabs.Root>
      </VStack>
    </SettingsLayout>
  );
}

/**
 * What the directory has been doing, who it did it to, and where it should
 * send the next one.
 *
 *   connections ──► the people they manage ──► the address to point at
 *
 * The order is the reader's own question narrowing: is it working, is it
 * working on the right people, and — only if they are still setting it up —
 * what do I paste into the identity provider. The people sit in the middle
 * because they are what the connections above them are FOR, and they are the
 * one thing the status band can count but cannot show.
 */
function OverviewTab({
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
    <VStack gap={6} width="full" align="start">
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
        <Text color="fg.muted" fontSize="sm">
          Each token works against one single sign-on connection and only
          manages the people that connection provisioned.
        </Text>
        <CopyValueRows
          rows={[
            {
              label: "Provisioning address",
              hint: "Paste this into your identity provider, with a token from the Tokens tab",
              value: scimBaseUrl,
            },
          ]}
        />
      </VStack>
    </VStack>
  );
}

function TokensSection({
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
      <HStack width="full">
        <Heading size="md">Provisioning tokens</Heading>
        <Spacer />
        {mayManage && (
          <Button size="sm" onClick={onGenerateOpen}>
            <Plus size={16} />
            Issue token
          </Button>
        )}
      </HStack>

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
