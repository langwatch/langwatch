/**
 * CLI device-flow approval page (RFC 8628 user_code entry + approval).
 *
 * Flow:
 *   1. User runs `langwatch login` in their terminal.
 *   2. CLI prints: "Open https://app.langwatch.com/cli/auth?user_code=WDJB-MJHT"
 *   3. User clicks → lands here. If unauthenticated, gets bounced through SSO.
 *   4. Page calls GET /api/auth/cli/lookup to verify the code is still pending.
 *   5. User picks an organization (if they're in multiple) and clicks "Approve".
 *   6. Page calls POST /api/auth/cli/approve which:
 *        a. Mints (or returns existing) personal VK
 *        b. Flips the device-code record to `approved` with the VK secret
 *   7. CLI's polling /exchange returns 200 with the secret on its next poll.
 *   8. Done, user closes the browser tab.
 *
 * Mirrors the screens-1-thru-4 storyboard in gateway.md.
 */
import {
  Box,
  Button,
  Card,
  Container,
  Heading,
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
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";

import { useSession } from "~/utils/auth-client";
import { setAttributionIfAbsent } from "~/utils/attribution";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { resolveCliAuthProjects } from "./cliAuthProjects";
import { ScopeChipPicker } from "~/components/settings/ScopeChipPicker";

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
      vkLabel: string;
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
  return (
    <Box
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

/**
 * Action row for terminal states (approved, denied, expired, error): the
 * flow is over either way — Go Home lands on "/" and the resolver picks
 * the right surface per org intent. Closing the tab is the user's own
 * gesture; browsers block window.close() on tabs with navigation history,
 * so we don't pretend to offer it.
 */
function TerminalActions() {
  return (
    <Button
      colorPalette="blue"
      width="full"
      onClick={() => {
        window.location.href = "/";
      }}
    >
      Go Home
    </Button>
  );
}

export default function CliAuthPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { organizations, project: currentProject } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

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
  // resolveCliAuthProjects hides personal workspace projects. Project login
  // must target a real, shared project, never a personal one (a coding agent
  // that picked one silently routed evaluations there), and the hidden
  // internal_governance tenancy project. It also picks the default: the last
  // project the user worked in when it's offered, else the sole project.
  const lastProjectSlug = currentProject?.slug ?? null;
  const {
    projects: projectsForOrg,
    teams: teamsForOrg,
    defaultProjectId,
  } = useMemo(() => {
    const org = organizations?.find((o) => o.id === selectedOrgId);
    return resolveCliAuthProjects({ teams: org?.teams, lastProjectSlug });
  }, [organizations, selectedOrgId, lastProjectSlug]);

  // Reset when org changes so the picker is fresh per-org, then apply the
  // computed default selection.
  useEffect(() => {
    setSelectedProjectId(null);
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
    if (!session && userCode) {
      const callbackUrl = `/cli/auth?user_code=${encodeURIComponent(userCode)}`;
      void router.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
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

  const handleApprove = async () => {
    if (!selectedOrgId || !userCode) return;
    if (requiresProject && !selectedProjectId) return;
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
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        personal_vk_label?: string;
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
        ? projectsForOrg.find((p) => p.id === selectedProjectId)?.name
        : undefined;
      setAction({
        kind: "success",
        vkLabel: data.personal_vk_label ?? "default",
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
    const seconds = Math.max(0, Math.round((lookup.expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `Expires in ~${minutes} min` : `Expires in ${seconds}s`;
  }, [lookup]);

  if (sessionStatus === "loading" || (!session && userCode)) {
    return <FullPageSpinner />;
  }

  return (
    <>
      <Head>
        <title>Authorize CLI · LangWatch</title>
      </Head>
      <Container maxWidth="540px" paddingTop="80px" paddingBottom="80px">
        <VStack align="stretch" gap={8}>
          <VStack align="center" gap={2} textAlign="center">
            <Heading
              as="h1"
              fontSize={{ base: "2xl", md: "3xl" }}
              letterSpacing="-0.035em"
              fontWeight={400}
              lineHeight="1.1"
              color="fg"
            >
              {requiresProject
                ? "Generate an SDK key"
                : "Authorize the LangWatch CLI"}
            </Heading>
            <Text color="fg.muted" textStyle="sm" lineHeight="1.65">
              {requiresProject
                ? "The CLI is requesting a project SDK API key"
                : "Signs in this device for AI-tool wrappers and governance commands"}
            </Text>
          </VStack>

          <Card.Root
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            boxShadow="sm"
          >
          <Card.Body>
            <VStack align="stretch" gap={6}>
              {!userCode && (
                <StatusCard
                  palette="orange"
                  icon={CircleAlert}
                  title="No code provided"
                >
                  Run <code>langwatch login</code> in your terminal, it will
                  print a link with your code embedded.
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
                  <StatusCard
                    palette="orange"
                    icon={Clock3}
                    title="Code expired"
                  >
                    Restart <code>langwatch login</code> in your terminal to
                    get a new code.
                  </StatusCard>
                  <TerminalActions />
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
                  <TerminalActions />
                </>
              )}

              {lookup.kind === "ready" && action.kind !== "success" && action.kind !== "denied" && (
                <>
                  <Text textStyle="sm" color="fg.muted" lineHeight="tall">
                    {requiresProject
                      ? "Pick the project to mint a key for; the key will flow back to your terminal automatically, with no copy-paste."
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
                      <Text
                        textStyle="sm"
                        fontWeight="semibold"
                        color="fg"
                        mb={2}
                      >
                        Project
                      </Text>
                      {projectsForOrg.length === 0 ? (
                        <StatusCard
                          palette="orange"
                          icon={CircleAlert}
                          title="No shared projects yet"
                        >
                          Create a team project in this organization first
                          (personal projects can&apos;t back an SDK key), then
                          re-run <code>langwatch login</code> in your terminal.
                        </StatusCard>
                      ) : (
                        <ScopeChipPicker
                          variant="single-select"
                          label=""
                          placeholder="Select a project"
                          allowedScopeTypes={["PROJECT"]}
                          organizationId={selectedOrgId ?? undefined}
                          availableProjects={projectsForOrg}
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
                      )}
                    </Box>
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
                        (requiresProject && !selectedProjectId)
                      }
                    >
                      {requiresProject ? "Generate API key" : "Approve"}
                    </Button>
                    <Button
                      variant="ghost"
                      color="fg.muted"
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
                      title="API key generated!"
                    >
                      A fresh project API key has been minted for{" "}
                      <strong>{action.projectName ?? "your project"}</strong> (
                      {action.organizationName}). The key flowed back to your
                      terminal automatically, and your <code>.env</code> is
                      updated. You can close this tab.
                    </StatusCard>
                  ) : (
                    <StatusCard
                      palette="green"
                      icon={CheckCircle2}
                      title="You're signed in!"
                    >
                      LangWatch CLI is now authorized for{" "}
                      <strong>{action.organizationName}</strong> using the{" "}
                      <code>{action.vkLabel}</code> personal key. You can close
                      this tab and return to your terminal.
                    </StatusCard>
                  )}
                  <TerminalActions />
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
                  <TerminalActions />
                </>
              )}
            </VStack>
          </Card.Body>
          </Card.Root>
        </VStack>
      </Container>
    </>
  );
}

function FullPageSpinner() {
  return (
    <Container maxWidth="400px" paddingTop="160px">
      <VStack gap={4}>
        <Spinner size="lg" />
        <Text textStyle="sm" color="fg.muted">
          Loading…
        </Text>
      </VStack>
    </Container>
  );
}
