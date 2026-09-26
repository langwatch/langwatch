// CLI device-flow approval (RFC 8628): lookup code, review scopes/perms, approve. Exchange
// unchanged; three fetch calls delegated to host. CreateProjectDrawer is recorded gap.

import { Box, Button, HStack, Icon, Spinner, Stack, Text, VStack } from "@chakra-ui/react";
import {
  CLI_KEY_MANAGEMENT_PERMISSIONS,
  cliKeyManagementPermissions,
  computePermissionsFromSelections,
  defaultCliKeyPermissions,
  selectionsFromPermissions,
} from "@langwatch/api-key-contract";
import { nowInstant } from "@langwatch/time";
import { CheckCircle2, CircleAlert, Clock3, Info, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import {
  CLI_LEAD_SOURCE,
  useApiKeyHost,
  type ApiKeyRouteReading,
  type CliCredentialType,
} from "../../model/api-key-host.ts";
import {
  clampSelectionsToAvailability,
  getUserPermissionsAcrossScopes,
} from "../../model/api-key-permissions.ts";
import { resolveCliAuthProjects } from "../../model/cli-auth-projects.ts";
import { defaultCliKeyScopes } from "../../model/cli-key-scope-defaults.ts";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../blocks/permission-category-list.tsx";
import { StatusCard } from "../blocks/status-card.tsx";
import { ScopeChipPicker, type ScopeTriadEntry } from "../elements/scope-picker.tsx";
import { CliAuthContainer } from "./cli-auth-container.tsx";
import { FirstTraceRedirect } from "./first-trace-redirect.tsx";

type LookupState =
  | { kind: "loading" }
  | {
      kind: "ready";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CliCredentialType;
      management: boolean;
    }
  | { kind: "error"; message: string }
  | { kind: "expired" };

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

export default function CliAuthScreen() {
  const host = useApiKeyHost();
  const reading = host.route();
  const sessionStatus = host.sessionStatus();
  const currentUserId = host.currentUser()?.id ?? null;
  const organizations = host.organizations();
  const scope = host.scope();

  const userCode = userCodeOf(reading);

  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // device_session mode: what the minted CLI key will be able to access.
  // Scopes preselect to the widest access the user holds (see
  // defaultCliKeyScopes); permissions start from the everyday-work default
  // and only switch to the category list when the user customizes.
  const [selectedScopes, setSelectedScopes] = useState<ScopeTriadEntry[]>([]);
  // The org the current scope defaults were computed for, so arriving data
  // never clobbers a user's edited selection within the same org.
  const [scopeDefaultsOrgId, setScopeDefaultsOrgId] = useState<string | null>(null);
  const [arePermissionsCustomized, setArePermissionsCustomized] = useState(false);
  const [permissionSelections, setPermissionSelections] = useState<
    Record<string, PermissionSelection>
  >({});
  // Step one: the code check gates the rest of the page (org picker, access
  // selection, approve) rather than being one card among many — it's the
  // phishing check. Confirmed as a value, not a flag: step two only opens
  // while the confirmed code still matches what's being looked at.
  const [confirmedUserCode, setConfirmedUserCode] = useState<string | null>(null);

  // A second login opened in this tab replaces the whole flow: any finished
  // approve/deny outcome and the previous lookup belong to the old code.
  useEffect(() => {
    setConfirmedUserCode(null);
    setAction({ kind: "idle" });
    setLookup({ kind: "loading" });
  }, [userCode]);

  // Auto-pick the first org if there's only one. The chooser is only
  // necessary when the user is in 2+.
  useEffect(() => {
    if (organizations && organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0]!.id);
    }
  }, [organizations, selectedOrgId]);

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
    if (sessionStatus !== "authenticated" || !organizations) return;
    if (organizations.length === 0 && userCode) {
      const returnTo = encodeURIComponent(`/cli/auth?user_code=${encodeURIComponent(userCode)}`);
      host.replace(`/onboarding/welcome?return_to=${returnTo}`);
    }
  }, [sessionStatus, organizations, userCode, host]);

  // Projects for the project-login picker: `resolveCliAuthProjects` groups
  // shared projects by team plus the caller's personal project as
  // "Personal" (preselected only when the org has none shared). The hidden
  // internal_governance tenancy project is never offered. Default: last
  // project worked in, else the sole shared project, else personal.
  const lastProjectSlug = scope.projectSlug ?? null;
  const {
    projects: projectsForOrg,
    teams: teamsForOrg,
    personalProject,
    defaultProjectId,
  } = useMemo(() => {
    const org = organizations?.find((o) => o.id === selectedOrgId);
    return resolveCliAuthProjects({
      teams: org?.teams,
      lastProjectSlug,
      currentUserId,
    });
  }, [organizations, selectedOrgId, lastProjectSlug, currentUserId]);

  const offeredProjects = useMemo(
    () => [...projectsForOrg, ...(personalProject ? [personalProject] : [])],
    [projectsForOrg, personalProject],
  );

  // Reset when org changes so the pickers are fresh per-org, then apply the
  // computed default selections.
  useEffect(() => {
    setSelectedProjectId(null);
    setSelectedScopes([]);
    setScopeDefaultsOrgId(null);
    setArePermissionsCustomized(false);
    setPermissionSelections({});
  }, [selectedOrgId]);
  useEffect(() => {
    if (defaultProjectId && !selectedProjectId) {
      setSelectedProjectId(defaultProjectId);
    }
  }, [defaultProjectId, selectedProjectId]);

  // Redirect to sign-in if unauthenticated, preserving the user_code in
  // the callback URL so the user lands back here after SSO.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "unauthenticated" && userCode) {
      const callbackUrl = `/cli/auth?user_code=${encodeURIComponent(userCode)}`;
      host.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [sessionStatus, userCode, host]);

  // Look up the device code once we have a session.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !userCode) return;
    let cancelled = false;
    void (async () => {
      const result = await host.lookupDeviceCode(userCode);
      if (cancelled) return;
      if (result.outcome === "expired") {
        setLookup({ kind: "expired" });
        return;
      }
      if (result.outcome === "unknown") {
        setLookup({
          kind: "error",
          message: `Code "${userCode}" was not recognised. It may have expired or already been used.`,
        });
        return;
      }
      if (result.outcome === "failed") {
        setLookup({ kind: "error", message: result.message });
        return;
      }
      setLookup({
        kind: "ready",
        userCode: result.userCode,
        status: result.status,
        expiresAt: result.expiresAt,
        credentialType: result.credentialType,
        management: result.management,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, userCode, host]);

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

  // Non-personal teams of the picked org, in display order. Personal teams
  // are never offered as scopes; the user's own personal workspace is
  // offered as its project instead.
  const sharedTeams = useMemo(() => {
    const org = organizations?.find((o) => o.id === selectedOrgId);
    return (org?.teams ?? [])
      .filter((team) => !team.isPersonal)
      .map((team) => ({ id: team.id, name: team.name }));
  }, [organizations, selectedOrgId]);

  const selectedOrgName = useMemo(
    () => organizations?.find((o) => o.id === selectedOrgId)?.name,
    [organizations, selectedOrgId],
  );

  // Preselect the widest access the user holds, once the bindings for the
  // picked org are in. Guarded by scopeDefaultsOrgId so a refetch never
  // clobbers scopes the user already edited.
  useEffect(() => {
    if (requiresProject) return;
    if (!selectedOrgId || !myBindings.data) return;
    if (scopeDefaultsOrgId === selectedOrgId) return;
    setSelectedScopes(
      defaultCliKeyScopes({
        organizationId: selectedOrgId,
        bindings: myBindings.data,
        sharedTeamIds: sharedTeams.map((team) => team.id),
        personalProject: personalProject
          ? { id: personalProject.id, teamId: personalProject.teamId }
          : null,
      }),
    );
    setScopeDefaultsOrgId(selectedOrgId);
  }, [
    requiresProject,
    selectedOrgId,
    myBindings.data,
    scopeDefaultsOrgId,
    sharedTeams,
    personalProject,
  ]);

  // The user's own permissions across EVERY selected scope, mirroring the
  // Create API key drawer: rows above this ceiling render locked. One
  // permission list serves every binding on the minted key, so the ceiling
  // is the intersection - a permission the user holds on one team but not
  // on another would make approve fail with api_key_scope_violation.
  const cliKeyUserPermissions = useMemo(() => {
    if (selectedScopes.length === 0 || !selectedOrgId) return [];
    return getUserPermissionsAcrossScopes({
      myBindings: myBindings.data,
      scopes: selectedScopes,
      organizationId: selectedOrgId,
      orgProjects: offeredProjects.map((p) => ({ id: p.id, teamId: p.teamId })),
      isServiceKey: false,
    });
  }, [selectedScopes, selectedOrgId, myBindings.data, offeredProjects]);

  // Whether the picker has anything to offer THIS user, which separates "you
  // deselected everything" from "there is nothing here for you". Read from
  // the same defaults the screen preselects, because a team listed in the
  // organization the user holds no binding on is not a scope they can bind.
  const hasAnyScopeToOffer = useMemo(() => {
    if (!selectedOrgId || !myBindings.data) return false;
    return (
      defaultCliKeyScopes({
        organizationId: selectedOrgId,
        bindings: myBindings.data,
        sharedTeamIds: sharedTeams.map((team) => team.id),
        personalProject: personalProject
          ? { id: personalProject.id, teamId: personalProject.teamId }
          : null,
      }).length > 0
    );
  }, [selectedOrgId, myBindings.data, sharedTeams, personalProject]);

  // The default list, narrowed to what the user actually holds everywhere the
  // key will be bound. The rule the key lives by is "never more than your own
  // access", and the mint asserts it: sending `project:manage` for a member
  // who does not hold it would refuse the whole approval rather than drop the
  // one permission.
  const defaultCliKeyPermissionsHeld = useMemo<string[]>(() => {
    const held = new Set(cliKeyUserPermissions);
    return defaultCliKeyPermissions({ management: requestsManagement }).filter((permission) =>
      held.has(permission),
    );
  }, [cliKeyUserPermissions, requestsManagement]);

  // Management access rides on the whole organization, and the key gets only
  // the management permissions the person holds there. Holding none is told
  // here, and the approval would be refused.
  const managementHeld = cliKeyManagementPermissions().filter((permission) =>
    cliKeyUserPermissions.includes(permission),
  );
  const cannotGrantManagement =
    requestsManagement &&
    !myBindings.isLoading &&
    selectedScopes.length > 0 &&
    managementHeld.length === 0;
  const managementNeedsOrganization =
    requestsManagement &&
    !cannotGrantManagement &&
    selectedScopes.length > 0 &&
    !selectedScopes.some((scopeEntry) => scopeEntry.scopeType === "ORGANIZATION");

  // The customized rows, re-narrowed to the ceiling of whatever is selected
  // NOW. Changing the scopes after customizing shrinks the ceiling, and a
  // level chosen under the old one would otherwise stay checked and fail the
  // approval with a scope violation.
  const effectivePermissionSelections = useMemo(
    () =>
      clampSelectionsToAvailability({
        selections: permissionSelections,
        userPermissions: cliKeyUserPermissions,
      }),
    [permissionSelections, cliKeyUserPermissions],
  );

  // The permission list the approve request carries. Untouched, the narrowed
  // default goes out; customized, it is exactly what the category selections
  // compute, itself bounded by the locked rows.
  const cliKeyPermissions = useMemo<string[]>(
    () =>
      arePermissionsCustomized
        ? computePermissionsFromSelections(effectivePermissionSelections)
        : defaultCliKeyPermissionsHeld,
    [arePermissionsCustomized, effectivePermissionSelections, defaultCliKeyPermissionsHeld],
  );

  const handleToggleCustomizePermissions = () => {
    if (arePermissionsCustomized) {
      setArePermissionsCustomized(false);
      setPermissionSelections({});
    } else {
      setPermissionSelections(selectionsFromPermissions(defaultCliKeyPermissionsHeld));
      setArePermissionsCustomized(true);
    }
  };

  // Approve stays unavailable while the bindings are still arriving: the
  // ceiling is empty until they land, so an approval sent now would carry an
  // empty permission list.
  const isDeviceSessionSelectionIncomplete =
    !requiresProject &&
    (myBindings.isLoading ||
      selectedScopes.length === 0 ||
      cliKeyPermissions.length === 0 ||
      cannotGrantManagement ||
      managementNeedsOrganization);

  const handleApprove = async () => {
    if (!selectedOrgId || !userCode) return;
    if (requiresProject && !selectedProjectId) return;
    if (isDeviceSessionSelectionIncomplete) return;
    // Same binding as the render gates, restated on the action itself: the
    // approval may only go out for the code the user confirmed.
    if (lookup.kind !== "ready" || lookup.userCode !== userCode) return;
    if (confirmedUserCode !== userCode) return;
    setAction({ kind: "submitting" });
    const result = await host.approveDeviceCode({
      userCode,
      organizationId: selectedOrgId,
      ...(requiresProject && selectedProjectId ? { projectId: selectedProjectId } : {}),
      ...(requiresProject
        ? {}
        : {
            keySelection: {
              bindings: selectedScopes.map((scopeEntry) => ({
                scopeType: scopeEntry.scopeType,
                scopeId: scopeEntry.scopeId,
              })),
              permissions: cliKeyPermissions,
            },
          }),
    });
    if (result.outcome === "failed") {
      setAction({ kind: "error", message: result.message });
      return;
    }
    const orgName = organizations?.find((o) => o.id === selectedOrgId)?.name ?? "your organization";
    const projectName = requiresProject
      ? offeredProjects.find((p) => p.id === selectedProjectId)?.name
      : undefined;
    setAction({
      kind: "success",
      organizationName: orgName,
      credentialType,
      projectName,
    });
  };

  const handleDeny = async () => {
    if (!userCode) return;
    setAction({ kind: "submitting" });
    await host.denyDeviceCode(userCode);
    // Denied either way: a network failure on the way to the deny endpoint
    // leaves the code to expire on its own, and telling the reader it worked
    // is the honest answer to what they asked for.
    setAction({ kind: "denied" });
  };

  const expiryText = useMemo(() => {
    if (lookup.kind !== "ready") return null;
    const seconds = Math.max(
      0,
      Math.round((lookup.expiresAt - nowInstant().epochMilliseconds) / 1000),
    );
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `Expires in ~${minutes} min` : `Expires in ${seconds}s`;
  }, [lookup]);

  // Every gate binds to userCode, not just to the lookup: the reset effect
  // runs after paint, so a route change first renders with the previous
  // code's lookup and confirmation. Comparing against userCode here keeps
  // that render from showing either step.
  const isApprovalReady =
    lookup.kind === "ready" &&
    lookup.userCode === userCode &&
    action.kind !== "success" &&
    action.kind !== "denied";
  const isCodeConfirmed = lookup.kind === "ready" && confirmedUserCode === userCode;

  if (sessionStatus === "loading" || (sessionStatus === "unauthenticated" && userCode)) {
    return <CliAuthContainer title="Authorize the LangWatch CLI" loading />;
  }

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
        {!userCode && (
          <StatusCard palette="orange" icon={CircleAlert} title="No code provided">
            Run <code>langwatch login</code> in your terminal, it will print a link with your code
            embedded.
          </StatusCard>
        )}

        {userCode && lookup.kind === "loading" && (
          <HStack>
            <Spinner size="sm" />
            <Text textStyle="sm" color="fg.muted">
              Looking up code…
            </Text>
          </HStack>
        )}

        {lookup.kind === "expired" && (
          <StatusCard palette="orange" icon={Clock3} title="Code expired">
            Restart <code>langwatch login</code> in your terminal to get a new code.
          </StatusCard>
        )}

        {lookup.kind === "error" && (
          <StatusCard palette="red" icon={TriangleAlert} title="Something went wrong">
            {lookup.message}
          </StatusCard>
        )}

        {isApprovalReady && !isCodeConfirmed && (
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
              {lookup.userCode}
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
              <Button
                colorPalette="orange"
                flex={1}
                onClick={() => {
                  if (lookup.kind === "ready") {
                    setConfirmedUserCode(lookup.userCode);
                  }
                }}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                color="fg.muted"
                borderColor="border.emphasized"
                onClick={() => void handleDeny()}
                loading={action.kind === "submitting"}
              >
                Deny
              </Button>
            </Stack>
          </>
        )}

        {isApprovalReady && isCodeConfirmed && (
          <>
            {organizations && organizations.length > 1 && (
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
                      onClick={() => setSelectedOrgId(org.id)}
                      justifyContent="flex-start"
                    >
                      {org.name}
                    </Button>
                  ))}
                </VStack>
              </Box>
            )}

            {requiresProject && (
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
                        params: { organizationId: selectedOrgId ?? void 0 },
                      })
                    }
                  >
                    <Icon as={Plus} boxSize={3.5} />
                    Create project
                  </Button>
                </HStack>
                {offeredProjects.length === 0 ? (
                  <StatusCard palette="orange" icon={CircleAlert} title="No projects yet">
                    Create a project in this organization first, then pick it here; the key flows
                    back to your terminal automatically.
                  </StatusCard>
                ) : (
                  <>
                    <ScopeChipPicker
                      variant="single-select"
                      label=""
                      placeholder="None selected"
                      allowedScopeTypes={["PROJECT"]}
                      organizationId={selectedOrgId ?? undefined}
                      availableProjects={offeredProjects}
                      availableTeams={teamsForOrg}
                      value={
                        selectedProjectId
                          ? [{ scopeType: "PROJECT", scopeId: selectedProjectId }]
                          : []
                      }
                      onChange={(next) => setSelectedProjectId(next[0]?.scopeId ?? null)}
                      showSummary={false}
                    />
                    {projectsForOrg.length === 0 &&
                      personalProject &&
                      selectedProjectId === personalProject.id && (
                        <Text textStyle="xs" color="fg.muted" mt={1.5}>
                          No shared projects in this organization yet, so your personal project is
                          preselected. Only you can read what lands there.
                        </Text>
                      )}
                  </>
                )}
              </Box>
            )}

            {!requiresProject && (
              <>
                <Box>
                  <Text textStyle="sm" fontWeight="semibold" color="fg" mb={1}>
                    What the CLI can access
                  </Text>
                  <Text textStyle="xs" color="fg.muted" mb={2}>
                    The key works inside these scopes, always limited to your own access.
                  </Text>
                  {myBindings.isLoading ? (
                    <HStack>
                      <Spinner size="sm" />
                      <Text textStyle="sm" color="fg.muted">
                        Loading your access…
                      </Text>
                    </HStack>
                  ) : (
                    <ScopeChipPicker
                      value={selectedScopes}
                      onChange={setSelectedScopes}
                      organizationId={selectedOrgId ?? undefined}
                      organizationName={selectedOrgName}
                      availableTeams={sharedTeams}
                      availableProjects={offeredProjects}
                      label=""
                      showSummary={false}
                    />
                  )}
                  {!myBindings.isLoading && selectedScopes.length === 0 && !hasAnyScopeToOffer && (
                    <Text textStyle="xs" color="orange.fg" mt={2}>
                      Your account holds no access in this organization, so there is nothing to give
                      the CLI. Ask an administrator to add you to a team, then run{" "}
                      <code>langwatch login</code> again.
                    </Text>
                  )}
                </Box>

                <Box>
                  <HStack justify="space-between" align="center" mb={1}>
                    <Text textStyle="sm" fontWeight="semibold" color="fg">
                      Permissions
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      color="fg.muted"
                      onClick={handleToggleCustomizePermissions}
                    >
                      {arePermissionsCustomized ? "Use default" : "Customize"}
                    </Button>
                  </HStack>
                  {arePermissionsCustomized ? (
                    <VStack align="stretch" gap={2}>
                      <PermissionCounter count={cliKeyPermissions.length} />
                      <PermissionCategoryList
                        selections={effectivePermissionSelections}
                        userPermissions={cliKeyUserPermissions}
                        onChange={setPermissionSelections}
                      />
                      {cliKeyPermissions.length === 0 && (
                        <Text textStyle="xs" color="fg.muted">
                          Select at least one permission to approve.
                        </Text>
                      )}
                    </VStack>
                  ) : requestsManagement && !cannotGrantManagement && managementHeld.length > 0 ? (
                    <Text textStyle="xs" color="fg.muted" lineHeight="tall">
                      The key gets your access for everyday work: traces, datasets, prompts,
                      evaluations, the AI Gateway, and project settings, plus the management access
                      below.
                    </Text>
                  ) : (
                    <Text textStyle="xs" color="fg.muted" lineHeight="tall">
                      The key gets your access for everyday work: traces, datasets, prompts,
                      evaluations, the AI Gateway, and project settings. It cannot manage members
                      and roles, or manage the organization.
                    </Text>
                  )}
                </Box>

                {requestsManagement && !cannotGrantManagement && managementHeld.length > 0 && (
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
                          {managementHeld.map((permission) => (
                            <li key={permission}>{CLI_KEY_MANAGEMENT_PERMISSIONS[permission]}</li>
                          ))}
                        </Box>
                      </VStack>
                    </HStack>
                  </Box>
                )}
                {cannotGrantManagement && (
                  <StatusCard
                    palette="red"
                    icon={TriangleAlert}
                    title="You have no management access here"
                  >
                    The CLI asked for management access, and your account holds no management
                    permission in this organization. Deny this request and run{" "}
                    <code>langwatch login --device</code> without <code>--management</code>, or ask
                    an organization admin.
                  </StatusCard>
                )}
                {managementNeedsOrganization && (
                  <StatusCard
                    palette="orange"
                    icon={CircleAlert}
                    title="Management access needs the organization"
                  >
                    The CLI asked for management access, which applies to the whole organization.
                    Add the organization to what the CLI can access to approve.
                  </StatusCard>
                )}
              </>
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
                loading={action.kind === "submitting"}
                disabled={
                  !selectedOrgId ||
                  (requiresProject && !selectedProjectId) ||
                  isDeviceSessionSelectionIncomplete
                }
              >
                {requiresProject ? "Send API key" : "Approve"}
              </Button>
              <Button
                variant="outline"
                color="fg.muted"
                borderColor="border.emphasized"
                onClick={() => void handleDeny()}
                loading={action.kind === "submitting"}
              >
                Deny
              </Button>
            </Stack>
          </>
        )}

        {action.kind === "success" && (
          <>
            {action.credentialType === "project_api_key" ? (
              <StatusCard palette="green" icon={CheckCircle2} title="API key approved">
                The API key for <strong>{action.projectName ?? "your project"}</strong> (
                {action.organizationName}) is on its way to your terminal, and the CLI will save it
                to your <code>.env</code>. You can close this tab.
              </StatusCard>
            ) : (
              <>
                <StatusCard palette="green" icon={CheckCircle2} title="You're signed in!">
                  LangWatch CLI is now authorized for <strong>{action.organizationName}</strong>.
                  You can close this tab and return to your terminal.
                </StatusCard>
                <FirstTraceRedirect />
              </>
            )}
          </>
        )}

        {action.kind === "denied" && (
          <StatusCard palette="blue" icon={Info} title="Authorization denied">
            The CLI session has been rejected. You can close this tab.
          </StatusCard>
        )}
      </VStack>
    </CliAuthContainer>
  );
}
