/**
 * CLI device-flow approval page (RFC 8628 user_code entry + approval).
 *
 * Flow:
 *   1. User runs `langwatch login` in their terminal.
 *   2. CLI prints: "Open https://app.langwatch.com/cli/auth?user_code=WDJB-MJHT"
 *   3. User clicks → lands here. If unauthenticated, gets bounced through SSO.
 *   4. Page asks the host to look the code up, which is GET /api/auth/cli/lookup.
 *   5. User confirms the code matches the one in their terminal.
 *   6. User picks an organization (if they're in multiple), reviews what the
 *      CLI key will be able to access (scopes + permissions, preselected to
 *      the widest access they hold minus organization management), and clicks
 *      "Approve".
 *   7. The host POSTs /api/auth/cli/approve which:
 *        a. Mints (or returns existing) personal VK
 *        b. Flips the device-code record to `approved` with the VK secret and
 *           the reviewed `key_selection` (scopes + permissions); the exchange
 *           endpoint mints the user-scoped CLI key from it
 *   8. CLI's polling /exchange returns 200 with the secret on its next poll.
 *   9. Done, user closes the browser tab.
 *
 * Mirrors the screens-1-thru-4 storyboard in gateway.md.
 *
 * ## What changed when this moved out of `platform/app`, and what did not
 *
 * THE EXCHANGE IS UNCHANGED, and that is the property this move is judged on:
 * the CLI in `sdks/typescript` is polling the other side of it. The three
 * `fetch` calls did not travel — a screen may not name `fetch`, and the wire is
 * a transport concern — so they are `host.lookupDeviceCode`,
 * `host.approveDeviceCode` and `host.denyDeviceCode`, and the adapter in
 * `apps/ui/src/features/api-key` spells the same three URLs, methods, bodies and
 * status-code readings. The SELECTION a request carries is decided here and
 * pinned here; the WIRE it goes out on is pinned in `apps/ui/tests`.
 *
 * THE CREATE-PROJECT SUB-FLOW IS A RECORDED GAP. `CreateProjectDrawer` is a
 * registered `platform/app` drawer that `DashboardLayout` also opens, and its
 * closure is `ProjectForm` — 301 lines of team selection, slug minting and
 * validation belonging to the organization settings family — so this move may
 * neither delete nor copy it. The button addresses the drawer through the host,
 * which is right and does not open yet: nothing mounts that registry above a
 * screen served from `apps/ui`. The old page then ADOPTED the created project by
 * matching the slug the drawer reported; without the drawer's callback there is
 * nothing to adopt, so that half is a loss until the chrome layout route lands.
 */

import { Box, Button, HStack, Icon, Spinner, Stack, Text, VStack } from "@chakra-ui/react";
import {
  computePermissionsFromSelections,
  defaultCliKeyPermissions,
  selectionsFromPermissions,
} from "@langwatch/api-key-contract";
import { ScopeChipPicker, type ScopeTriadEntry } from "../../ui/elements/scope-picker";
import { CheckCircle2, CircleAlert, Clock3, Info, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiKeyApi } from "../../behavior/api-key-api";
import {
  useApiKeyHost,
  type ApiKeyRouteReading,
  type CliCredentialType,
} from "../../model/api-key-host";
import {
  clampSelectionsToAvailability,
  getUserPermissionsAcrossScopes,
} from "../../model/api-key-permissions";
import { resolveCliAuthProjects } from "../../model/cli-auth-projects";
import { defaultCliKeyScopes } from "../../model/cli-key-scope-defaults";
import { StatusCard } from "../../ui/blocks/status-card";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../../ui/blocks/permission-category-list";
import { CliAuthContainer } from "../../ui/sections/cli-auth-container";
import { FirstTraceRedirect } from "../../ui/sections/first-trace-redirect";

/** The acquisition source a browser opened by `langwatch login` stamps. */
export const CLI_LEAD_SOURCE = "cli";

type LookupState =
  | { kind: "loading" }
  | {
      kind: "ready";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CliCredentialType;
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
 * The `user_code` the address carries.
 *
 * A query key can legitimately arrive repeated, and the route port answers a
 * single value per key (last write wins), so nothing has to be normalised here
 * any more — the platform page's array guard was for the framework router that
 * parsed repeats into arrays.
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
  // Step one of the screen: the code check. The organization picker, the
  // access selection and the approve action only appear once the user
  // confirms the code matches their terminal, so the phishing check is not
  // one card among many but the gate to the rest of the page. Confirmed as a
  // value rather than a flag: step two only opens when the confirmed code is
  // still the code being looked at.
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

  // First-touch acquisition source: a browser opened by `langwatch login`
  // carries no utm/ref params, so stamp the CLI as lead source here. The
  // round-trip through onboarding then lands it in signupData and the
  // Customer.io lead_source trait. First-touch semantics: a user who
  // originally arrived via a campaign keeps their real source, which is the
  // host method's whole contract.
  useEffect(() => {
    host.recordLeadSourceIfAbsent(CLI_LEAD_SOURCE);
  }, [host]);

  // Brand-new user (signed up mid-CLI-login, no org yet): approval needs an
  // organization, so round-trip through onboarding and come straight back —
  // return_to preserves the user_code so the CLI's poll can still succeed.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !organizations) return;
    if (organizations.length === 0 && userCode) {
      const returnTo = encodeURIComponent(`/cli/auth?user_code=${encodeURIComponent(userCode)}`);
      host.replace(`/onboarding/welcome?return_to=${returnTo}`);
    }
  }, [sessionStatus, organizations, userCode, host]);

  // Projects offered in the project-login picker (project_api_key mode).
  // resolveCliAuthProjects offers the shared projects grouped by team plus
  // the caller's own personal project as an explicit "Personal" entry
  // (silent auto-selection of personal was the historical hazard; explicit
  // choice is honoured server-side, and it is preselected only when the org
  // has no shared projects at all). The hidden internal_governance tenancy
  // project is never offered. The default is the last project the user
  // worked in when offered, else the sole shared project, else personal.
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
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, userCode, host]);

  const credentialType: CliCredentialType =
    lookup.kind === "ready" ? lookup.credentialType : "device_session";
  const requiresProject = credentialType === "project_api_key";

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
  // is the intersection — a permission the user holds on one team but not
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
    return defaultCliKeyPermissions().filter((permission) => held.has(permission));
  }, [cliKeyUserPermissions]);

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
    (myBindings.isLoading || selectedScopes.length === 0 || cliKeyPermissions.length === 0);

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
    const seconds = Math.max(0, Math.round((lookup.expiresAt - Date.now()) / 1000));
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
                  ) : (
                    <Text textStyle="xs" color="fg.muted" lineHeight="tall">
                      The key gets your access for everyday work: traces, datasets, prompts,
                      evaluations, the AI Gateway, and project settings. It cannot manage members
                      and roles, or manage the organization.
                    </Text>
                  )}
                </Box>
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
