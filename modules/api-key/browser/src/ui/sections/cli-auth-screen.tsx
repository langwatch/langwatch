// CLI device-flow approval (RFC 8628): lookup code, review scopes/perms, approve. Exchange
// unchanged; three fetch calls delegated to host. CreateProjectDrawer is recorded gap.

import {
  CLI_KEY_MANAGEMENT_PERMISSIONS,
  cliKeyManagementPermissions,
  type CliKeyManagementPermission,
} from "@langwatch/api-key-contract";
import {
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { CheckCircle2, CircleAlert, Clock3, Info, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import { useCliKeyPermissions, useCliKeyScopes } from "../../behavior/use-cli-key-access.ts";
import { useCliLoginTarget } from "../../behavior/use-cli-login-target.ts";
import {
  useDeviceCodeLookup,
  type DeviceCodeLookupState,
} from "../../behavior/use-device-code-lookup.ts";
import {
  CLI_LEAD_SOURCE,
  useApiKeyHost,
  type ApiKeyHostApi,
  type ApiKeyOrganization,
  type ApiKeyRouteReading,
  type ApiKeySessionStatus,
  type CliCredentialType,
  type CliDeviceApproval,
} from "../../model/api-key-host.ts";
import type { CliAuthProjectOption, CliAuthTeamOption } from "../../model/cli-auth-projects.ts";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../blocks/permission-category-list.tsx";
import { StatusCard } from "../blocks/status-card.tsx";
import { ScopeChipPicker, type ScopeTriadEntry } from "../elements/scope-picker.tsx";
import { CliAuthContainer } from "./cli-auth-container.tsx";
import { FirstTraceRedirect } from "./first-trace-redirect.tsx";

type ActionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      organizationName: string;
      credentialType: CliCredentialType;
      projectName?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "denied" };

/**
 * The `user_code` the address carries. A repeated query key is fine: the
 * route port already answers one value per key (last write wins), so
 * nothing needs normalising here.
 */
function userCodeOf(reading: ApiKeyRouteReading): string {
  return reading.query.user_code ?? "";
}

function expiryTextFor(lookup: DeviceCodeLookupState): string | null {
  if (lookup.kind !== "ready") return null;
  const seconds = Math.max(
    0,
    Math.round((lookup.expiresAt - nowInstant().epochMilliseconds) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `Expires in ~${minutes} min` : `Expires in ${seconds}s`;
}

/** A project login names its project; a device session carries its scopes and permissions. */
function approvalSelection({
  requiresProject,
  selectedProjectId,
  selectedScopes,
  permissions,
}: {
  requiresProject: boolean;
  selectedProjectId: string | null;
  selectedScopes: ScopeTriadEntry[];
  permissions: string[];
}): Pick<CliDeviceApproval, "projectId" | "keySelection"> {
  if (requiresProject) return selectedProjectId ? { projectId: selectedProjectId } : {};
  return {
    keySelection: {
      bindings: selectedScopes.map((scopeEntry) => ({
        scopeType: scopeEntry.scopeType,
        scopeId: scopeEntry.scopeId,
      })),
      permissions,
    },
  };
}

/** Sends the approval and answers with what the screen shows next. */
async function approveDeviceLogin({
  host,
  approval,
  organizationName,
  credentialType,
  projectName,
}: {
  host: ApiKeyHostApi;
  approval: CliDeviceApproval;
  organizationName: string | undefined;
  credentialType: CliCredentialType;
  projectName: string | undefined;
}): Promise<ActionState> {
  const result = await host.approveDeviceCode(approval);
  if (result.outcome === "failed") return { kind: "error", message: result.message };
  return {
    kind: "success",
    organizationName: organizationName ?? "your organization",
    credentialType,
    projectName,
  };
}

/**
 * Denied either way: a network failure on the way to the deny endpoint leaves the code to
 * expire on its own, and telling the reader it worked is the honest answer to what they asked.
 */
async function denyDeviceLogin({
  host,
  userCode,
  setAction,
}: {
  host: ApiKeyHostApi;
  userCode: string | null;
  setAction: (action: ActionState) => void;
}): Promise<void> {
  if (!userCode) return;
  setAction({ kind: "submitting" });
  await host.denyDeviceCode(userCode);
  setAction({ kind: "denied" });
}

/** Redirects to sign-in, or through onboarding for a reader with no organization yet. */
function useCliAuthRedirects({
  host,
  sessionStatus,
  organizations,
  userCode,
}: {
  host: ApiKeyHostApi;
  sessionStatus: ApiKeySessionStatus;
  organizations: ApiKeyOrganization[] | undefined;
  userCode: string;
}) {
  // First-touch acquisition: a browser opened by `langwatch login` carries no
  // utm/ref params, so stamp the CLI as lead source here — it lands in
  // signupData and the Customer.io lead_source trait via onboarding.
  // First-touch: a user who arrived via a campaign keeps that real source.
  useEffect(() => {
    host.recordLeadSourceIfAbsent(CLI_LEAD_SOURCE);
  }, [host]);

  // Brand-new user (signed up mid-CLI-login, no org yet): approval needs an
  // organization, so round-trip through onboarding and come straight back  -
  // return_to preserves the user_code so the CLI's poll can still succeed.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || organizations?.length !== 0 || !userCode) return;
    const returnTo = encodeURIComponent(`/cli/auth?user_code=${encodeURIComponent(userCode)}`);
    host.replace(`/onboarding/welcome?return_to=${returnTo}`);
  }, [sessionStatus, organizations, userCode, host]);

  // Redirect to sign-in if unauthenticated, preserving the user_code in
  // the callback URL so the user lands back here after SSO.
  useEffect(() => {
    if (sessionStatus !== "unauthenticated" || !userCode) return;
    const callbackUrl = `/cli/auth?user_code=${encodeURIComponent(userCode)}`;
    host.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [sessionStatus, userCode, host]);
}

/**
 * Approve stays unavailable while the bindings are still arriving: the ceiling is
 * empty until they land, so an approval sent now would carry an empty permission list.
 */
function isApprovalIncomplete({
  selectedOrgId,
  requiresProject,
  selectedProjectId,
  isLoadingBindings,
  isBindingsFailed,
  scopeCount,
  permissionCount,
  isManagementBlocked,
}: {
  selectedOrgId: string | null;
  requiresProject: boolean;
  selectedProjectId: string | null;
  isLoadingBindings: boolean;
  isBindingsFailed: boolean;
  scopeCount: number;
  permissionCount: number;
  isManagementBlocked: boolean;
}): boolean {
  if (!selectedOrgId) return true;
  if (requiresProject) return !selectedProjectId;
  return (
    isLoadingBindings ||
    isBindingsFailed ||
    scopeCount === 0 ||
    permissionCount === 0 ||
    isManagementBlocked
  );
}

type ManagementRequest = {
  /** The management permissions the reader holds, which the key also gets. */
  held: CliKeyManagementPermission[];
  cannotGrant: boolean;
  needsOrganization: boolean;
};

/**
 * Management access rides on the whole organization, and the key gets only the
 * management permissions the reader holds there; holding none refuses the approval.
 */
function managementRequestFor({
  requestsManagement,
  isLoadingBindings,
  selectedScopes,
  userPermissions,
}: {
  requestsManagement: boolean;
  isLoadingBindings: boolean;
  selectedScopes: ScopeTriadEntry[];
  userPermissions: string[];
}): ManagementRequest {
  const held = requestsManagement
    ? cliKeyManagementPermissions().filter((permission) => userPermissions.includes(permission))
    : [];
  const hasScopes = selectedScopes.length > 0;
  const cannotGrant = requestsManagement && !isLoadingBindings && hasScopes && held.length === 0;
  const needsOrganization =
    requestsManagement &&
    !cannotGrant &&
    hasScopes &&
    !selectedScopes.some((scopeEntry) => scopeEntry.scopeType === "ORGANIZATION");
  return { held, cannotGrant, needsOrganization };
}

/**
 * Every gate binds to userCode, not just to the lookup: the reset effect runs after
 * paint, so a route change first renders with the previous code's lookup and
 * confirmation. Comparing against userCode keeps that render from showing either step.
 */
function approvalGates({
  lookup,
  userCode,
  action,
  confirmedUserCode,
}: {
  lookup: DeviceCodeLookupState;
  userCode: string;
  action: ActionState;
  confirmedUserCode: string | null;
}) {
  const isLookupCurrent = lookup.kind === "ready" && lookup.userCode === userCode;
  const isFinished = action.kind === "success" || action.kind === "denied";
  return {
    isLookupCurrent,
    isApprovalReady: isLookupCurrent && !isFinished,
    isCodeConfirmed: lookup.kind === "ready" && confirmedUserCode === userCode,
  };
}

export default function CliAuthScreen() {
  const host = useApiKeyHost();
  const reading = host.route();
  const sessionStatus = host.sessionStatus();
  const currentUserId = host.currentUser()?.id ?? null;
  const organizations = host.organizations();
  const scope = host.scope();

  const userCode = userCodeOf(reading);

  const lookup = useDeviceCodeLookup({ host, sessionStatus, userCode });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });
  // Step one: the code check gates the rest of the page (org picker, access
  // selection, approve) rather than being one card among many — it's the
  // phishing check. Confirmed as a value, not a flag: step two only opens
  // while the confirmed code still matches what's being looked at.
  const [confirmedUserCode, setConfirmedUserCode] = useState<string | null>(null);

  // A second login opened in this tab replaces the whole flow: any finished
  // approve/deny outcome belongs to the old code.
  useEffect(() => {
    setConfirmedUserCode(null);
    setAction({ kind: "idle" });
  }, [userCode]);

  const target = useCliLoginTarget({
    organizations,
    lastProjectSlug: scope.projectSlug ?? null,
    currentUserId,
  });
  const { selectedOrgId, selectedOrg, selectedProjectId, offeredProjects } = target;

  useCliAuthRedirects({ host, sessionStatus, organizations, userCode });

  const credentialType: CliCredentialType =
    lookup.kind === "ready" ? lookup.credentialType : "device_session";
  const requiresProject = credentialType === "project_api_key";
  // `langwatch login --management` asked for management access on the key.
  const requestsManagement = lookup.kind === "ready" && !requiresProject && lookup.management;

  // The user's own role bindings in the picked org: the ceiling the CLI key
  // can never exceed. Drives the scope defaults and which permission rows
  // are available in the customize list.
  const myBindings = apiKeyApi.apiKey.myBindings.useQuery(
    { organizationId: selectedOrgId ?? "" },
    { enabled: !!selectedOrgId && lookup.kind === "ready" && !requiresProject },
  );

  const keyScopes = useCliKeyScopes({
    organizationId: selectedOrgId,
    requiresProject,
    bindings: myBindings.data,
    sharedTeams: target.sharedTeams,
    personalProject: target.personalProject,
  });
  const keyPermissions = useCliKeyPermissions({
    organizationId: selectedOrgId,
    selectedScopes: keyScopes.selectedScopes,
    bindings: myBindings.data,
    offeredProjects,
    management: requestsManagement,
  });
  const management = managementRequestFor({
    requestsManagement,
    isLoadingBindings: myBindings.isLoading,
    selectedScopes: keyScopes.selectedScopes,
    userPermissions: keyPermissions.userPermissions,
  });

  const isSelectionIncomplete = isApprovalIncomplete({
    selectedOrgId,
    requiresProject,
    selectedProjectId,
    isLoadingBindings: myBindings.isLoading,
    isBindingsFailed: myBindings.isError,
    scopeCount: keyScopes.selectedScopes.length,
    permissionCount: keyPermissions.permissions.length,
    isManagementBlocked: management.cannotGrant || management.needsOrganization,
  });
  const { isLookupCurrent, isApprovalReady, isCodeConfirmed } = approvalGates({
    lookup,
    userCode,
    action,
    confirmedUserCode,
  });

  const handleApprove = async () => {
    // Same binding as the render gates, restated on the action itself: the
    // approval may only go out for the code the user confirmed.
    if (!selectedOrgId || !userCode || isSelectionIncomplete) return;
    if (!isLookupCurrent || confirmedUserCode !== userCode) return;
    setAction({ kind: "submitting" });
    setAction(
      await approveDeviceLogin({
        host,
        approval: {
          userCode,
          organizationId: selectedOrgId,
          ...approvalSelection({
            requiresProject,
            selectedProjectId,
            selectedScopes: keyScopes.selectedScopes,
            permissions: keyPermissions.permissions,
          }),
        },
        organizationName: selectedOrg?.name,
        credentialType,
        projectName: requiresProject
          ? offeredProjects.find((p) => p.id === selectedProjectId)?.name
          : undefined,
      }),
    );
  };

  const handleDeny = () => denyDeviceLogin({ host, userCode, setAction });

  if (sessionStatus === "loading" || (sessionStatus === "unauthenticated" && userCode)) {
    return <CliAuthContainer title="Authorize the LangWatch CLI" loading />;
  }

  const isSubmitting = action.kind === "submitting";

  return (
    <CliAuthContainer
      title={requiresProject ? "Connect a project to the CLI" : "Authorize the LangWatch CLI"}
      subTitle={
        requiresProject
          ? "The CLI is requesting a project SDK API key"
          : "Signs in this device for AI-tool wrappers and governance commands"
      }
    >
      <VStack align="stretch" gap={6}>
        <LookupStatus userCode={userCode} lookup={lookup} />

        {isApprovalReady && !isCodeConfirmed && (
          <CodeConfirmation
            userCode={userCode}
            requiresProject={requiresProject}
            expiryText={expiryTextFor(lookup)}
            isSubmitting={isSubmitting}
            onConfirm={() => setConfirmedUserCode(userCode)}
            onDeny={() => void handleDeny()}
          />
        )}

        {isApprovalReady && isCodeConfirmed && (
          <>
            <OrganizationChooser
              organizations={organizations ?? []}
              selectedOrgId={selectedOrgId}
              onSelect={target.setSelectedOrgId}
            />

            {requiresProject && (
              <ProjectPicker
                host={host}
                organizationId={selectedOrgId}
                offeredProjects={offeredProjects}
                teams={target.teamsForOrg}
                selectedProjectId={selectedProjectId}
                onSelect={target.setSelectedProjectId}
                isPersonalFallback={target.isPersonalFallback}
              />
            )}

            {!requiresProject && (
              <>
                <CliKeyScopesField
                  organizationId={selectedOrgId}
                  organizationName={selectedOrg?.name}
                  sharedTeams={target.sharedTeams}
                  offeredProjects={offeredProjects}
                  isLoading={myBindings.isLoading}
                  selectedScopes={keyScopes.selectedScopes}
                  onChange={keyScopes.setSelectedScopes}
                  hasAnyScopeToOffer={keyScopes.hasAnyScopeToOffer}
                />
                <CliKeyPermissionsField
                  isCustomized={keyPermissions.isCustomized}
                  onToggleCustomized={keyPermissions.toggleCustomized}
                  permissionCount={keyPermissions.permissions.length}
                  selections={keyPermissions.effectiveSelections}
                  userPermissions={keyPermissions.userPermissions}
                  onChange={keyPermissions.setSelections}
                  grantsManagement={management.held.length > 0}
                />
                <CliManagementRequest management={management} />
              </>
            )}

            {myBindings.isError && (
              <StatusCard palette="red" icon={TriangleAlert} title="Couldn't read your access">
                The key can only carry the access you hold, so it can't be approved until that
                loads. Reload and try again.
              </StatusCard>
            )}

            {action.kind === "error" && (
              <StatusCard palette="red" icon={TriangleAlert} title="Approval failed">
                {action.message}
              </StatusCard>
            )}

            <Stack direction={{ base: "column", sm: "row" }} gap={3}>
              <Button
                colorPalette="orange"
                flex={1}
                onClick={() => void handleApprove()}
                loading={isSubmitting}
                disabled={isSelectionIncomplete}
              >
                {requiresProject ? "Send API key" : "Approve"}
              </Button>
              <DenyButton isSubmitting={isSubmitting} onDeny={() => void handleDeny()} />
            </Stack>
          </>
        )}

        <ActionOutcome action={action} />
      </VStack>
    </CliAuthContainer>
  );
}

function DenyButton({ isSubmitting, onDeny }: { isSubmitting: boolean; onDeny: () => void }) {
  return (
    <Button
      variant="outline"
      color="fg.muted"
      borderColor="border.emphasized"
      onClick={onDeny}
      loading={isSubmitting}
    >
      Deny
    </Button>
  );
}

/** Everything before a code is ready: no code, looking it up, expired, or refused. */
function LookupStatus({ userCode, lookup }: { userCode: string; lookup: DeviceCodeLookupState }) {
  if (!userCode) {
    return (
      <StatusCard palette="orange" icon={CircleAlert} title="No code provided">
        Run <code>langwatch login</code> in your terminal, it will print a link with your code
        embedded.
      </StatusCard>
    );
  }
  if (lookup.kind === "loading") {
    return (
      <HStack>
        <Spinner size="sm" />
        <Text textStyle="sm" color="fg.muted">
          Looking up code…
        </Text>
      </HStack>
    );
  }
  if (lookup.kind === "expired") {
    return (
      <StatusCard palette="orange" icon={Clock3} title="Code expired">
        Restart <code>langwatch login</code> in your terminal to get a new code.
      </StatusCard>
    );
  }
  if (lookup.kind === "error") {
    return (
      <StatusCard palette="red" icon={TriangleAlert} title="Something went wrong">
        {lookup.message}
      </StatusCard>
    );
  }
  return null;
}

/** Step one, the phishing check: the code shown here must match the terminal's. */
function CodeConfirmation({
  userCode,
  requiresProject,
  expiryText,
  isSubmitting,
  onConfirm,
  onDeny,
}: {
  userCode: string;
  requiresProject: boolean;
  expiryText: string | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onDeny: () => void;
}) {
  return (
    <>
      <Text textStyle="sm" color="fg.muted" lineHeight="tall">
        {requiresProject
          ? "Pick a project, its API key flows back to your terminal automatically, with no copy-paste."
          : "Approving signs in this device for AI-tool wrappers (Claude, Codex, etc.) and governance commands."}
      </Text>
      <Box
        bg="bg.subtle"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        p={4}
        fontFamily="mono"
        fontSize="2xl"
        fontWeight="bold"
        textAlign="center"
        letterSpacing="0.2em"
        color="fg"
      >
        {userCode}
      </Box>
      <Text textStyle="xs" color="fg.muted" textAlign="center">
        Confirm this matches the code shown in your terminal.
        {expiryText ? (
          <>
            <br />
            {expiryText}.
          </>
        ) : null}
      </Text>
      <Stack direction={{ base: "column", sm: "row" }} gap={3}>
        <Button colorPalette="orange" flex={1} onClick={onConfirm}>
          Confirm
        </Button>
        <DenyButton isSubmitting={isSubmitting} onDeny={onDeny} />
      </Stack>
    </>
  );
}

/** Only for a reader in two or more organizations; one is picked for them. */
function OrganizationChooser({
  organizations,
  selectedOrgId,
  onSelect,
}: {
  organizations: ApiKeyOrganization[];
  selectedOrgId: string | null;
  onSelect: (organizationId: string) => void;
}) {
  if (organizations.length <= 1) return null;
  return (
    <Box>
      <Text textStyle="sm" fontWeight="semibold" color="fg" mb={2}>
        Organization
      </Text>
      <VStack align="stretch" gap={2}>
        {organizations.map((org) => (
          <Button
            key={org.id}
            size="sm"
            colorPalette={selectedOrgId === org.id ? "orange" : "gray"}
            variant={selectedOrgId === org.id ? "surface" : "outline"}
            onClick={() => onSelect(org.id)}
            justifyContent="flex-start"
          >
            {org.name}
          </Button>
        ))}
      </VStack>
    </Box>
  );
}

function ProjectPicker({
  host,
  organizationId,
  offeredProjects,
  teams,
  selectedProjectId,
  onSelect,
  isPersonalFallback,
}: {
  host: ApiKeyHostApi;
  organizationId: string | null;
  offeredProjects: CliAuthProjectOption[];
  teams: CliAuthTeamOption[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  /** No shared project exists, so the reader's personal one was preselected. */
  isPersonalFallback: boolean;
}) {
  return (
    <Box>
      <HStack mb={2} justify="space-between" align="center">
        <Text textStyle="sm" fontWeight="semibold" color="fg">
          Project
        </Text>
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          onClick={() =>
            host.openPlatformDrawer({
              drawer: "createProject",
              params: { organizationId: organizationId ?? void 0 },
            })
          }
        >
          <Icon as={Plus} boxSize={3.5} />
          Create project
        </Button>
      </HStack>
      {offeredProjects.length === 0 ? (
        <StatusCard palette="orange" icon={CircleAlert} title="No projects yet">
          Create a project in this organization first, then pick it here; the key flows back to your
          terminal automatically.
        </StatusCard>
      ) : (
        <>
          <ScopeChipPicker
            variant="single-select"
            label=""
            placeholder="None selected"
            allowedScopeTypes={["PROJECT"]}
            organizationId={organizationId ?? undefined}
            availableProjects={offeredProjects}
            availableTeams={teams}
            value={selectedProjectId ? [{ scopeType: "PROJECT", scopeId: selectedProjectId }] : []}
            onChange={(next) => onSelect(next[0]?.scopeId ?? null)}
            showSummary={false}
          />
          {isPersonalFallback && (
            <Text textStyle="xs" color="fg.muted" mt={1.5}>
              No shared projects in this organization yet, so your personal project is preselected.
              Only you can read what lands there.
            </Text>
          )}
        </>
      )}
    </Box>
  );
}

function CliKeyScopesField({
  organizationId,
  organizationName,
  sharedTeams,
  offeredProjects,
  isLoading,
  selectedScopes,
  onChange,
  hasAnyScopeToOffer,
}: {
  organizationId: string | null;
  organizationName: string | undefined;
  sharedTeams: { id: string; name: string }[];
  offeredProjects: CliAuthProjectOption[];
  isLoading: boolean;
  selectedScopes: ScopeTriadEntry[];
  onChange: (scopes: ScopeTriadEntry[]) => void;
  hasAnyScopeToOffer: boolean;
}) {
  return (
    <Box>
      <Text textStyle="sm" fontWeight="semibold" color="fg" mb={1}>
        What the CLI can access
      </Text>
      <Text textStyle="xs" color="fg.muted" mb={2}>
        The key works inside these scopes, always limited to your own access.
      </Text>
      {isLoading ? (
        <HStack>
          <Spinner size="sm" />
          <Text textStyle="sm" color="fg.muted">
            Loading your access…
          </Text>
        </HStack>
      ) : (
        <ScopeChipPicker
          value={selectedScopes}
          onChange={onChange}
          organizationId={organizationId ?? undefined}
          organizationName={organizationName}
          availableTeams={sharedTeams}
          availableProjects={offeredProjects}
          label=""
          showSummary={false}
        />
      )}
      {!isLoading && selectedScopes.length === 0 && !hasAnyScopeToOffer && (
        <Text textStyle="xs" color="orange.fg" mt={2}>
          Your account holds no access in this organization, so there is nothing to give the CLI.
          Ask an administrator to add you to a team, then run <code>langwatch login</code> again.
        </Text>
      )}
    </Box>
  );
}

function CliKeyPermissionsField({
  isCustomized,
  onToggleCustomized,
  permissionCount,
  selections,
  userPermissions,
  onChange,
  grantsManagement,
}: {
  isCustomized: boolean;
  onToggleCustomized: () => void;
  permissionCount: number;
  selections: Record<string, PermissionSelection>;
  userPermissions: string[];
  onChange: (selections: Record<string, PermissionSelection>) => void;
  grantsManagement: boolean;
}) {
  return (
    <Box>
      <HStack justify="space-between" align="center" mb={1}>
        <Text textStyle="sm" fontWeight="semibold" color="fg">
          Permissions
        </Text>
        <Button size="xs" variant="ghost" color="fg.muted" onClick={onToggleCustomized}>
          {isCustomized ? "Use default" : "Customize"}
        </Button>
      </HStack>
      {isCustomized ? (
        <VStack align="stretch" gap={2}>
          <PermissionCounter count={permissionCount} />
          <PermissionCategoryList
            selections={selections}
            userPermissions={userPermissions}
            onChange={onChange}
          />
          {permissionCount === 0 && (
            <Text textStyle="xs" color="fg.muted">
              Select at least one permission to approve.
            </Text>
          )}
        </VStack>
      ) : (
        <DefaultAccessNote grantsManagement={grantsManagement} />
      )}
    </Box>
  );
}

/** What the default permissions reach, and whether management access rides on top. */
function DefaultAccessNote({ grantsManagement }: { grantsManagement: boolean }) {
  return (
    <Text textStyle="xs" color="fg.muted" lineHeight="tall">
      The key gets your access for everyday work: traces, datasets, prompts, evaluations, the AI
      Gateway, and project settings
      {grantsManagement
        ? ", plus the management access below."
        : ". It cannot manage members and roles, or manage the organization."}
    </Text>
  );
}

/** What `langwatch login --management` adds to the key, or why it cannot be approved here. */
function CliManagementRequest({ management }: { management: ManagementRequest }) {
  if (management.cannotGrant) {
    return (
      <StatusCard palette="red" icon={TriangleAlert} title="You have no management access here">
        The CLI asked for management access, and your account holds no management permission in this
        organization. Deny this request and run <code>langwatch login --device</code> without{" "}
        <code>--management</code>, or ask an organization admin.
      </StatusCard>
    );
  }

  return (
    <>
      {management.held.length > 0 && <ManagementGrantList held={management.held} />}
      {management.needsOrganization && (
        <StatusCard
          palette="orange"
          icon={CircleAlert}
          title="Management access needs the organization"
        >
          The CLI asked for management access, which applies to the whole organization. Add the
          organization to what the CLI can access to approve.
        </StatusCard>
      )}
    </>
  );
}

/** The management permissions the key gets on top of everyday access. */
function ManagementGrantList({ held }: { held: CliKeyManagementPermission[] }) {
  return (
    <Box
      data-testid="cli-auth-management-request"
      borderWidth="1px"
      borderColor="blue.muted"
      borderRadius="lg"
      bg="blue.subtle"
      paddingX={5}
      paddingY={4}
    >
      <HStack align="flex-start" gap={3}>
        <Icon as={Info} boxSize={5} color="blue.fg" flexShrink={0} marginTop={0.5} />
        <VStack align="stretch" gap={1} flex={1}>
          <Text textStyle="sm" fontWeight="semibold" color="fg" lineHeight="snug">
            Management access requested
          </Text>
          <Text textStyle="xs" color="fg.muted" lineHeight="tall">
            The CLI asked for management access. The key also gets:
          </Text>
          <Box as="ul" paddingStart={4} textStyle="xs" color="fg.muted">
            {held.map((permission) => (
              <li key={permission}>{CLI_KEY_MANAGEMENT_PERMISSIONS[permission]}</li>
            ))}
          </Box>
        </VStack>
      </HStack>
    </Box>
  );
}

/** How the flow ended: approved for a project or a session, or denied. */
function ActionOutcome({ action }: { action: ActionState }) {
  if (action.kind === "denied") {
    return (
      <StatusCard palette="blue" icon={Info} title="Authorization denied">
        The CLI session has been rejected. You can close this tab.
      </StatusCard>
    );
  }
  if (action.kind !== "success") return null;
  if (action.credentialType === "project_api_key") {
    return (
      <StatusCard palette="green" icon={CheckCircle2} title="API key approved">
        The API key for <strong>{action.projectName ?? "your project"}</strong> (
        {action.organizationName}) is on its way to your terminal, and the CLI will save it to your{" "}
        <code>.env</code>. You can close this tab.
      </StatusCard>
    );
  }
  return (
    <>
      <StatusCard palette="green" icon={CheckCircle2} title="You're signed in!">
        LangWatch CLI is now authorized for <strong>{action.organizationName}</strong>. You can
        close this tab and return to your terminal.
      </StatusCard>
      <FirstTraceRedirect />
    </>
  );
}
