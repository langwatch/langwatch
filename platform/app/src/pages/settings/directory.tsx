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
import { PeopleSection } from "../../components/access/PeopleSection";
import { TeamsAndProjectsSection } from "../../components/access/TeamsAndProjectsSection";
import { CopyInput } from "../../components/CopyInput";
import { PermissionAlert } from "../../components/PermissionAlert";
import SettingsLayout from "../../components/SettingsLayout";
import { CopyValueRows } from "../../components/settings/CopyValueRows";
import { ScimReconciliationPanel } from "../../components/settings/ScimReconciliationPanel";
import { SettingsDisclosure } from "../../components/settings/SettingsDisclosure";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { TabCount } from "../../components/settings/TabCount";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../../components/ui/toaster";
import { isRunningConnection } from "../../features/directory/logic/connectionLifecycle";
import { directoryConnectionsBadge } from "../../features/directory/logic/directorySyncChip";
import { showErrorToast } from "../../features/errors";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

/**
 * The Directory: who is in this organization, how they got here, and which
 * system says so (D05, D08, D11, D12, ADR-122).
 *
 * ONE PAGE FOR "WHO IS HERE". Members, Teams & Projects and Access were three
 * navigation entries answering one question in three vocabularies: a list of
 * people, a list of the containers those people sit in, and the rules by which
 * somebody becomes one of them. An administrator asking "who is in my
 * organization and how did they get here" had to visit all three and hold the
 * answer in their head. They are the Directory now, and the three old
 * addresses forward onto the tab each became.
 *
 * NAMED FOR WHAT IT HOLDS, NOT FOR THE PROTOCOL THAT FILLS IT. The navigation
 * entry says Directory, because "SCIM" is a thing an IT administrator has
 * heard of and everybody else has not. The word survives in the body copy, so
 * the administrator who searches for the protocol still lands here.
 *
 * STATUS LEADS, AND STANDS ABOVE THE TABS. Which sources are connected, when
 * the last push landed, how many people the directory manages and how many
 * members it does NOT manage are the reason anybody opens this page, and every
 * tab under them is what to do about the answer. Putting the band inside a tab
 * would hide the question from three quarters of the page.
 *
 * FOUR TABS, FOUR SUBJECTS, DRAWN ONE WAY.
 *
 *   People ────── everybody here and everybody on their way in, as three cuts
 *                 of one list, with the rule that admits them underneath
 *   Teams ─────── the teams, and the projects each one holds
 *   Groups ────── every group in the organization, the sent ones and the
 *                 hand-made ones alike
 *   Provisioning ─ what the directory has been doing, per connection, the
 *                 people it created, and the credential it syncs with
 *
 * Each tab puts its own action at the end of its own first heading row, and
 * each carries its count on the tab itself. Four tabs that each placed those
 * somewhere else read as four products rather than one page.
 *
 * THE RULE LIVES WITH THE PEOPLE IT ADMITS. Who may join without an invitation
 * governs exactly who turns up in the list above it, so it sits under that
 * list rather than on a page of its own called Access — a word that described
 * every page in this cluster and therefore none of them. The second-factor
 * requirement went the other way, to Authentication, because it is a condition
 * of signing in rather than of becoming a member.
 *
 * TWO PERMISSIONS, TWO JOBS, AND NEITHER IS THE WHOLE PAGE. Reading what a
 * directory did takes `sso:view` — the D05 "see single sign-on" permission —
 * because it is a security reviewer's job. The people, the teams, the groups
 * and the joining rule take `organization:manage`. A reader holding either
 * gets the page with the tabs they may open and no others, rather than the
 * page refusing them outright for lacking the half they did not come for.
 * Issuing and revoking a token takes `sso:manage`: a reader without it is
 * offered no control at all, since a disabled button is still an invitation,
 * and inviting somebody to do a thing they will be refused for is worse than
 * not offering it.
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

const TABS = ["people", "teams", "groups", "provisioning"] as const;
type DirectoryTab = (typeof TABS)[number];

/** What the reader may open here. */
interface DirectoryReach {
  /** `sso:view`: the status band, the connection detail and the tokens. */
  maySeeSync: boolean;
  /**
   * `organization:manage`: the people, the teams, the groups, the joining
   * rule, and the counts that read membership.
   */
  mayManageMembership: boolean;
}

/** Which permission each tab is behind, in one table rather than four
 *  conditionals scattered around a `<Tabs.Root>`. */
const TAB_NEEDS_MEMBERSHIP: Record<DirectoryTab, boolean> = {
  people: true,
  teams: true,
  groups: true,
  provisioning: false,
};

/**
 * The tab actually opened, given what the address asked for and what the
 * reader may have.
 *
 * A tab a reader may not open never becomes the open one, however the address
 * arrived — a link a colleague pasted, a bookmark, or one of the three old
 * addresses forwarding onto the tab it became. Pure, so the decision can be
 * read in one place.
 */
export function resolveDirectoryTab({
  requested,
  maySeeSync,
  mayManageMembership,
}: DirectoryReach & { requested: string | null }): DirectoryTab {
  const asked: DirectoryTab = TABS.includes(requested as DirectoryTab)
    ? (requested as DirectoryTab)
    : "people";
  const mayOpen = TAB_NEEDS_MEMBERSHIP[asked]
    ? mayManageMembership
    : maySeeSync;
  if (mayOpen) return asked;
  // Whichever half of the page the reader actually holds. People first,
  // because a reader with membership came for the people.
  return mayManageMembership ? "people" : "provisioning";
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
    mayManageMembership: hasPermission("organization:manage"),
  };
  const mayManageTokens = hasPermission("sso:manage");

  // The counts the tabs carry. Read here rather than inside each tab, because
  // a number on a closed tab is the reason somebody opens it — a count that
  // only appears once you are already looking answers nothing.
  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  const teams = api.team.getTeamsWithRoleBindings.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  // The same reads the People tab runs, so react-query serves both from one
  // request and the tab's number can never disagree with its own list.
  const members =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: true },
      { enabled: reach.mayManageMembership && !!organizationId },
    );
  const invites = api.organization.getOrganizationPendingInvites.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  const waiting = api.joinRequests.pending.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );

  // HOW MANY DIRECTORIES, AND WHETHER THEY ARE WORKING — on the closed tab.
  // The count says there are two; the colour says whether either has stopped,
  // which is the half an administrator wants before deciding to open it.
  // Retired connections are left out: they provision nobody, so counting them
  // makes one working directory read as three.
  const reconciliation = api.scimReconciliation.getAll.useQuery(
    { organizationId },
    { enabled: reach.maySeeSync && !!organizationId },
  );
  const connectionsBadge = directoryConnectionsBadge(
    reconciliation.data?.connections.filter(isRunningConnection),
  );

  /**
   * Everybody the People tab would list: the members, the invitations still
   * waiting on somebody, and the people asking to join. Undefined until all
   * three have answered, so the tab shows no number rather than a number that
   * is about to grow.
   */
  const peopleCount =
    members.data && invites.data && waiting.data
      ? members.data.members.length +
        invites.data.filter(
          (invite) =>
            invite.displayStatus === "PENDING" ||
            invite.displayStatus === "EXPIRED",
        ).length +
        waiting.data.length
      : undefined;

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

  if (!reach.maySeeSync && !reach.mayManageMembership) {
    return (
      <SettingsLayout>
        <PermissionAlert permission="sso:view" />
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        {/* THE WAY BACK to Authentication is on the Authentication source
            fact in the band below, as a plus beside the sources themselves. A
            whole sentence of a button under the page title said the same thing
            louder, in the one place a reader is looking for the page's own
            subject rather than for somewhere else to go. */}
        <SettingsPageHeader
          title="Directory"
          description="Who is in this organization, how they got here, and which system says so."
        />

        {reach.maySeeSync && (
          <DirectorySummary
            organizationId={organizationId}
            canReadMembership={reach.mayManageMembership}
          />
        )}

        <Tabs.Root
          value={tab}
          onValueChange={(event) => selectTab(event.value)}
          colorPalette="blue"
          width="full"
        >
          {/* The same gap Roles leaves under its own tabs. Two tabbed
              settings pages sitting one menu item apart must not breathe
              differently.

              The explicit space before each count is not decoration: a flex
              container drops whitespace-only children from layout but keeps
              them in the text the accessible name is computed from, so
              without it a tab announces as "Groups4", one run-together
              token. */}
          <Tabs.List marginBottom={6}>
            {reach.mayManageMembership && (
              <Tabs.Trigger value="people" gap={2}>
                People <TabCount value={peopleCount} />
              </Tabs.Trigger>
            )}
            {reach.mayManageMembership && (
              <Tabs.Trigger value="teams" gap={2}>
                Teams &amp; projects <TabCount value={teams.data?.length} />
              </Tabs.Trigger>
            )}
            {reach.mayManageMembership && (
              <Tabs.Trigger value="groups" gap={2}>
                Groups <TabCount value={groups.data?.length} />
              </Tabs.Trigger>
            )}
            {reach.maySeeSync && (
              <Tabs.Trigger value="provisioning" gap={2}>
                Provisioning{" "}
                <TabCount
                  value={connectionsBadge.count}
                  tone={connectionsBadge.tone}
                  title={connectionsBadge.title}
                  data-testid="provisioning-connections-count"
                />
              </Tabs.Trigger>
            )}
          </Tabs.List>

          {reach.mayManageMembership && (
            <Tabs.Content value="people">
              {/* Only the tab being read is mounted: a closed tab must not
                  hold a read of every member in the organization open behind
                  it, nor offer its actions to somebody looking elsewhere. */}
              {tab === "people" && (
                <PeopleSection organizationId={organizationId} />
              )}
            </Tabs.Content>
          )}

          {reach.mayManageMembership && (
            <Tabs.Content value="teams">
              {tab === "teams" && (
                <TeamsAndProjectsSection organizationId={organizationId} />
              )}
            </Tabs.Content>
          )}

          {reach.mayManageMembership && (
            <Tabs.Content value="groups">
              {tab === "groups" && (
                <GroupsSection
                  organizationId={organizationId}
                  canManage={true}
                />
              )}
            </Tabs.Content>
          )}

          {reach.maySeeSync && (
            <Tabs.Content value="provisioning">
              {/* ProvisioningTab is a fragment of stacked blocks, so the tab
                  supplies the column that spaces them — the same column every
                  other tab on this page uses. */}
              {tab === "provisioning" && (
                <VStack gap={6} width="full" align="stretch">
                  <ProvisioningTab
                    organizationId={organizationId}
                    mayReadMembership={reach.mayManageMembership}
                    maySetUpSingleSignOn={mayManageTokens}
                  />
                  <TokensSection
                    organizationId={organizationId}
                    mayManage={mayManageTokens}
                  />
                </VStack>
              )}
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
function ProvisioningTab({
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
