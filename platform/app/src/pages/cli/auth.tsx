/**
 * CLI device-flow approval page (RFC 8628 user_code entry + approval).
 *
 * Flow:
 *   1. User runs `langwatch login` in their terminal.
 *   2. CLI prints: "Open https://app.langwatch.com/cli/auth?user_code=WDJB-MJHT"
 *   3. User clicks → lands here. If unauthenticated, gets bounced through SSO.
 *   4. Page calls GET /api/auth/cli/lookup to verify the code is still pending.
 *   5. User picks an organization (if they're in multiple), reviews what the
 *      CLI key will be able to access (scopes + permissions, preselected to
 *      the widest access they hold minus organization management), and clicks
 *      "Approve".
 *   6. Page calls POST /api/auth/cli/approve which:
 *        a. Mints (or returns existing) personal VK
 *        b. Flips the device-code record to `approved` with the VK secret and
 *           the reviewed `key_selection` (scopes + permissions); the exchange
 *           endpoint mints the user-scoped CLI key from it
 *   7. CLI's polling /exchange returns 200 with the secret on its next poll.
 *   8. Done, user closes the browser tab.
 *
 * Mirrors the screens-1-thru-4 storyboard in gateway.md.
 */
import {
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Info,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreateProjectDrawer } from "~/components/projects/CreateProjectDrawer";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
} from "~/components/settings/ScopeChipPicker";
import { OnboardingContainer } from "~/features/onboarding/components/containers/OnboardingContainer";
import type { TeamUserRole } from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getTeamRolePermissions } from "~/server/api/rbac";
import { defaultCliKeyPermissions } from "~/server/api-key/cli-key-defaults";
import {
  computePermissionsFromSelections,
  selectionsFromPermissions,
} from "~/server/api-key/permission-categories";
import { api } from "~/utils/api";
import { setAttributionIfAbsent } from "~/utils/attribution";
import { useSession } from "~/utils/auth-client";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../settings/api-keys/PermissionCategoryList";
import {
  clampSelectionsToAvailability,
  getUserPermissionsAcrossScopes,
} from "../settings/api-keys/utils";
import { resolveCliAuthProjects } from "./cliAuthProjects";
import { defaultCliKeyScopes } from "./cliKeyScopeDefaults";
import { FirstTraceRedirect } from "./FirstTraceRedirect";

/**
 * Credential the CLI is requesting.
 *  - `device_session`: user-scoped CLI session token written to
 *    `~/.langwatch/config.json`. Used by `langwatch claude/codex/etc`,
 *    `whoami`, governance commands. Today's only mode.
 *  - `project_api_key`: project-scoped SDK API key written to `.env`.
 *    Used by `langwatch sync`, `langwatch eval`, `langwatch prompt`,
 *    and the SDK auto-instrumentation. Replaces the legacy paste-back
 *    flow with the same no-paste UX as device sessions.
 */
type CredentialType = "device_session" | "project_api_key";

type LookupState =
  | { kind: "loading" }
  | {
      kind: "ready";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CredentialType;
    }
  | { kind: "error"; message: string }
  | { kind: "expired" };

type ActionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      organizationName: string;
      credentialType: CredentialType;
      projectName?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "denied" };

/**
 * Status card in the traces-v2 visual language (semantic palette tokens,
 * lucide icon in a subtle tinted container — see
 * features/traces-v2/docs/STANDARDS.md §4): replaces the stock Alert for
 * this page's states.
 */
function StatusCard({
  palette,
  icon,
  title,
  children,
}: {
  palette: "green" | "red" | "orange" | "blue";
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  // Match the old Chakra Alert semantics: errors interrupt (role="alert"),
  // success/info states announce politely (role="status").
  const role = palette === "red" || palette === "orange" ? "alert" : "status";
  return (
    <Box
      role={role}
      borderWidth="1px"
      borderColor={`${palette}.muted`}
      borderRadius="lg"
      bg={`${palette}.subtle`}
      paddingX={5}
      paddingY={4}
    >
      <HStack align="flex-start" gap={3}>
        <Icon
          as={icon}
          boxSize={5}
          color={`${palette}.fg`}
          flexShrink={0}
          marginTop={0.5}
        />
        <VStack align="stretch" gap={1} flex={1}>
          <Text
            textStyle="sm"
            fontWeight="semibold"
            color="fg"
            lineHeight="snug"
          >
            {title}
          </Text>
          <Text textStyle="xs" color="fg.muted" lineHeight="tall">
            {children}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

export default function CliAuthPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { organizations, project: currentProject } = useOrganizationTeamProject(
    {
      redirectToOnboarding: false,
    },
  );

  // router.query values can legitimately be string | string[] | undefined
  // (Next.js parses repeated query keys as arrays). The CLI always emits a
  // single user_code, but we defensively normalise rather than blind-cast.
  const rawUserCode = router.query.user_code;
  const userCode =
    typeof rawUserCode === "string"
      ? rawUserCode
      : Array.isArray(rawUserCode)
        ? (rawUserCode[0] ?? "")
        : "";

  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );

  // device_session mode: what the minted CLI key will be able to access.
  // Scopes preselect to the widest access the user holds (see
  // defaultCliKeyScopes); permissions start from the everyday-work default
  // and only switch to the category list when the user customizes.
  const [selectedScopes, setSelectedScopes] = useState<ScopeTriadEntry[]>([]);
  // The org the current scope defaults were computed for, so arriving data
  // never clobbers a user's edited selection within the same org.
  const [scopeDefaultsOrgId, setScopeDefaultsOrgId] = useState<string | null>(
    null,
  );
  const [arePermissionsCustomized, setArePermissionsCustomized] =
    useState(false);
  const [permissionSelections, setPermissionSelections] = useState<
    Record<string, PermissionSelection>
  >({});

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
  // originally arrived via a campaign keeps their real source.
  useEffect(() => {
    setAttributionIfAbsent("leadSource", "cli");
  }, []);

  // Brand-new user (signed up mid-CLI-login, no org yet): approval needs an
  // organization, so round-trip through onboarding and come straight back —
  // return_to preserves the user_code so the CLI's poll can still succeed.
  useEffect(() => {
    if (!session || !organizations) return;
    if (organizations.length === 0 && userCode) {
      const returnTo = encodeURIComponent(
        `/cli/auth?user_code=${encodeURIComponent(userCode)}`,
      );
      void router.replace(`/onboarding/welcome?return_to=${returnTo}`);
    }
  }, [session, organizations, userCode, router]);

  // Projects offered in the project-login picker (project_api_key mode).
  // resolveCliAuthProjects offers the shared projects grouped by team plus
  // the caller's own personal project as an explicit "Personal" entry
  // (silent auto-selection of personal was the historical hazard; explicit
  // choice is honoured server-side, and it is preselected only when the org
  // has no shared projects at all). The hidden internal_governance tenancy
  // project is never offered. The default is the last project the user
  // worked in when offered, else the sole shared project, else personal.
  const lastProjectSlug = currentProject?.slug ?? null;
  const currentUserId = session?.user?.id ?? null;
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

  // "Create project" from the no-shared-projects state. The drawer needs no
  // ambient project; on creation the org list refreshes and the effect below
  // promotes the new project (matched by slug) to the current selection.
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [pendingCreatedSlug, setPendingCreatedSlug] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!pendingCreatedSlug) return;
    const created = projectsForOrg.find((p) => p.slug === pendingCreatedSlug);
    if (created) {
      setSelectedProjectId(created.id);
      setPendingCreatedSlug(null);
    }
  }, [pendingCreatedSlug, projectsForOrg]);

  // Redirect to sign-in if unauthenticated, preserving the user_code in
  // the callback URL so the user lands back here after SSO.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session && userCode) {
      const callbackUrl = `/cli/auth?user_code=${encodeURIComponent(userCode)}`;
      void router.replace(
        `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
  }, [session, sessionStatus, userCode, router]);

  // Look up the device code once we have a session.
  useEffect(() => {
    if (!session || !userCode) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/auth/cli/lookup?user_code=${encodeURIComponent(userCode)}`,
        );
        if (cancelled) return;
        if (r.status === 410) {
          setLookup({ kind: "expired" });
          return;
        }
        if (r.status === 404) {
          setLookup({
            kind: "error",
            message: `Code "${userCode}" was not recognised. It may have expired or already been used.`,
          });
          return;
        }
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as {
            error_description?: string;
          };
          setLookup({
            kind: "error",
            message: data.error_description ?? `Lookup failed (${r.status})`,
          });
          return;
        }
        const data = (await r.json()) as {
          user_code: string;
          status: string;
          expires_at: number;
          credential_type?: CredentialType;
        };
        // Defensive: backend may not yet emit `credential_type` on older
        // deployments. Default to `device_session` so the existing UX
        // path keeps working until the discriminator ships server-side.
        const credentialType: CredentialType =
          data.credential_type === "project_api_key" ||
          data.credential_type === "device_session"
            ? data.credential_type
            : "device_session";
        setLookup({
          kind: "ready",
          userCode: data.user_code,
          status: data.status,
          expiresAt: data.expires_at,
          credentialType,
        });
      } catch (err) {
        if (cancelled) return;
        setLookup({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, userCode]);

  const credentialType: CredentialType =
    lookup.kind === "ready" ? lookup.credentialType : "device_session";
  const requiresProject = credentialType === "project_api_key";

  // The user's own role bindings in the picked org: the ceiling the CLI key
  // can never exceed. Drives the scope defaults and which permission rows
  // are available in the customize list.
  const myBindings = api.apiKey.myBindings.useQuery(
    { organizationId: selectedOrgId ?? "" },
    {
      enabled: !!selectedOrgId && lookup.kind === "ready" && !requiresProject,
    },
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
        personalProjectId: personalProject?.id ?? null,
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
      getTeamRolePermissions: (role) =>
        getTeamRolePermissions(role as TeamUserRole),
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
        personalProjectId: personalProject?.id ?? null,
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
    return defaultCliKeyPermissions().filter((permission) =>
      held.has(permission),
    );
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
    [
      arePermissionsCustomized,
      effectivePermissionSelections,
      defaultCliKeyPermissionsHeld,
    ],
  );

  const handleToggleCustomizePermissions = () => {
    if (arePermissionsCustomized) {
      setArePermissionsCustomized(false);
      setPermissionSelections({});
    } else {
      setPermissionSelections(
        selectionsFromPermissions(defaultCliKeyPermissionsHeld),
      );
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
      cliKeyPermissions.length === 0);

  const handleApprove = async () => {
    if (!selectedOrgId || !userCode) return;
    if (requiresProject && !selectedProjectId) return;
    if (isDeviceSessionSelectionIncomplete) return;
    setAction({ kind: "submitting" });
    try {
      const r = await fetch("/api/auth/cli/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: userCode,
          organization_id: selectedOrgId,
          ...(requiresProject && selectedProjectId
            ? { project_id: selectedProjectId }
            : {}),
          ...(requiresProject
            ? {}
            : {
                key_selection: {
                  bindings: selectedScopes.map((scope) => ({
                    scope_type: scope.scopeType,
                    scope_id: scope.scopeId,
                  })),
                  permissions: cliKeyPermissions,
                },
              }),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error_description?: string;
        message?: string;
      };
      if (!r.ok) {
        setAction({
          kind: "error",
          message:
            data.message ??
            data.error_description ??
            `Approval failed (${r.status})`,
        });
        return;
      }
      const orgName =
        organizations?.find((o) => o.id === selectedOrgId)?.name ??
        "your organization";
      const projectName = requiresProject
        ? offeredProjects.find((p) => p.id === selectedProjectId)?.name
        : undefined;
      setAction({
        kind: "success",
        organizationName: orgName,
        credentialType,
        projectName,
      });
    } catch (err) {
      setAction({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleDeny = async () => {
    if (!userCode) return;
    setAction({ kind: "submitting" });
    try {
      await fetch("/api/auth/cli/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: userCode }),
      });
      setAction({ kind: "denied" });
    } catch {
      setAction({ kind: "denied" });
    }
  };

  const expiryText = useMemo(() => {
    if (lookup.kind !== "ready") return null;
    const seconds = Math.max(
      0,
      Math.round((lookup.expiresAt - Date.now()) / 1000),
    );
    const minutes = Math.floor(seconds / 60);
    return minutes > 0
      ? `Expires in ~${minutes} min`
      : `Expires in ${seconds}s`;
  }, [lookup]);

  if (sessionStatus === "loading" || (!session && userCode)) {
    return <FullPageSpinner />;
  }

  return (
    <>
      <Head>
        <title>Authorize CLI · LangWatch</title>
      </Head>
      <OnboardingContainer
        title={
          requiresProject
            ? "Connect a project to the CLI"
            : "Authorize the LangWatch CLI"
        }
        subTitle={
          requiresProject
            ? "The CLI is requesting a project SDK API key"
            : "Signs in this device for AI-tool wrappers and governance commands"
        }
        showBackButton={false}
        isLogoInside
      >
        <VStack align="stretch" gap={6}>
          {!userCode && (
            <StatusCard
              palette="orange"
              icon={CircleAlert}
              title="No code provided"
            >
              Run <code>langwatch login</code> in your terminal, it will print a
              link with your code embedded.
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
            <>
              <StatusCard palette="orange" icon={Clock3} title="Code expired">
                Restart <code>langwatch login</code> in your terminal to get a
                new code.
              </StatusCard>
            </>
          )}

          {lookup.kind === "error" && (
            <>
              <StatusCard
                palette="red"
                icon={TriangleAlert}
                title="Something went wrong"
              >
                {lookup.message}
              </StatusCard>
            </>
          )}

          {lookup.kind === "ready" &&
            action.kind !== "success" &&
            action.kind !== "denied" && (
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

                {organizations && organizations.length > 1 && (
                  <Box>
                    <Text
                      textStyle="sm"
                      fontWeight="semibold"
                      color="fg"
                      mb={2}
                    >
                      Organization
                    </Text>
                    <VStack align="stretch" gap={2}>
                      {organizations.map((org) => (
                        <Button
                          key={org.id}
                          size="sm"
                          colorPalette={
                            selectedOrgId === org.id ? "orange" : "gray"
                          }
                          variant={
                            selectedOrgId === org.id ? "surface" : "outline"
                          }
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
                        onClick={() => setCreateProjectOpen(true)}
                      >
                        <Icon as={Plus} boxSize={3.5} />
                        Create project
                      </Button>
                    </HStack>
                    {offeredProjects.length === 0 ? (
                      <StatusCard
                        palette="orange"
                        icon={CircleAlert}
                        title="No projects yet"
                      >
                        Create a project in this organization first, then pick
                        it here; the key flows back to your terminal
                        automatically.
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
                              ? [
                                  {
                                    scopeType: "PROJECT",
                                    scopeId: selectedProjectId,
                                  },
                                ]
                              : []
                          }
                          onChange={(next) =>
                            setSelectedProjectId(next[0]?.scopeId ?? null)
                          }
                          showSummary={false}
                        />
                        {projectsForOrg.length === 0 &&
                          personalProject &&
                          selectedProjectId === personalProject.id && (
                            <Text textStyle="xs" color="fg.muted" mt={1.5}>
                              No shared projects in this organization yet, so
                              your personal project is preselected. Only you can
                              read what lands there.
                            </Text>
                          )}
                      </>
                    )}
                  </Box>
                )}

                {!requiresProject && (
                  <>
                    <Box>
                      <Text
                        textStyle="sm"
                        fontWeight="semibold"
                        color="fg"
                        mb={1}
                      >
                        What the CLI can access
                      </Text>
                      <Text textStyle="xs" color="fg.muted" mb={2}>
                        The key works inside these scopes, always limited to
                        your own access.
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
                      {!myBindings.isLoading &&
                        selectedScopes.length === 0 &&
                        !hasAnyScopeToOffer && (
                          <Text textStyle="xs" color="orange.fg" mt={2}>
                            Your account holds no access in this organization,
                            so there is nothing to give the CLI. Ask an
                            administrator to add you to a team, then run{" "}
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
                          {arePermissionsCustomized
                            ? "Use default"
                            : "Customize"}
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
                          The key gets your access for everyday work: traces,
                          datasets, prompts, evaluations, the AI Gateway, and
                          project settings. It cannot manage members and roles,
                          or manage the organization.
                        </Text>
                      )}
                    </Box>
                  </>
                )}

                {action.kind === "error" && (
                  <StatusCard
                    palette="red"
                    icon={TriangleAlert}
                    title="Approval failed"
                  >
                    {action.message}
                  </StatusCard>
                )}

                <Stack direction={{ base: "column", sm: "row" }} gap={3}>
                  <Button
                    colorPalette="orange"
                    flex={1}
                    onClick={handleApprove}
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
                    onClick={handleDeny}
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
                <StatusCard
                  palette="green"
                  icon={CheckCircle2}
                  title="API key approved"
                >
                  The API key for{" "}
                  <strong>{action.projectName ?? "your project"}</strong> (
                  {action.organizationName}) is on its way to your terminal, and
                  the CLI will save it to your <code>.env</code>. You can close
                  this tab.
                </StatusCard>
              ) : (
                <>
                  <StatusCard
                    palette="green"
                    icon={CheckCircle2}
                    title="You're signed in!"
                  >
                    LangWatch CLI is now authorized for{" "}
                    <strong>{action.organizationName}</strong>. You can close
                    this tab and return to your terminal.
                  </StatusCard>
                  <FirstTraceRedirect />
                </>
              )}
            </>
          )}

          {action.kind === "denied" && (
            <>
              <StatusCard
                palette="blue"
                icon={Info}
                title="Authorization denied"
              >
                The CLI session has been rejected. You can close this tab.
              </StatusCard>
            </>
          )}
        </VStack>
        {createProjectOpen && (
          <CreateProjectDrawer
            open
            onClose={() => setCreateProjectOpen(false)}
            organizationId={selectedOrgId ?? undefined}
            onCreated={(created) => {
              setPendingCreatedSlug(created.projectSlug);
              setCreateProjectOpen(false);
            }}
          />
        )}
      </OnboardingContainer>
    </>
  );
}

function FullPageSpinner() {
  return (
    <OnboardingContainer
      title="Authorize the LangWatch CLI"
      loading
      isLogoInside
    >
      {null}
    </OnboardingContainer>
  );
}
