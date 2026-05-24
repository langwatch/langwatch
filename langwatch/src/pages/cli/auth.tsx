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
 *   8. Done — user closes the browser tab.
 *
 * Mirrors the screens-1-thru-4 storyboard in gateway.md.
 */
import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";

import { useSession } from "~/utils/auth-client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

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

export default function CliAuthPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { organizations } = useOrganizationTeamProject({
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

  // Projects scoped to the selected org, flattened across teams. Drives
  // the project picker that only renders for `project_api_key` mode.
  // Excludes the hidden `internal_governance` project — it's a system
  // tenancy boundary, never a target for SDK keys.
  const projectsForOrg = useMemo(() => {
    if (!selectedOrgId || !organizations) return [] as Array<{
      id: string;
      name: string;
      slug: string;
      teamName: string;
    }>;
    const org = organizations.find((o) => o.id === selectedOrgId);
    if (!org) return [];
    return (org.teams ?? []).flatMap((team) =>
      (team.projects ?? [])
        .filter((p) => p.slug !== "internal_governance")
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          teamName: team.name,
        })),
    );
  }, [organizations, selectedOrgId]);

  // Auto-pick the only project, if there is exactly one. Reset when org
  // changes so the picker is fresh per-org.
  useEffect(() => {
    setSelectedProjectId(null);
  }, [selectedOrgId]);
  useEffect(() => {
    if (projectsForOrg.length === 1 && !selectedProjectId) {
      setSelectedProjectId(projectsForOrg[0]!.id);
    }
  }, [projectsForOrg, selectedProjectId]);

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
        <title>Authorize CLI — LangWatch</title>
      </Head>
      <Container maxWidth="540px" paddingTop="80px" paddingBottom="80px">
        <Card.Root>
          <Card.Header>
            <HStack width="full" align="center">
              <Heading as="h1" size="md">
                {requiresProject
                  ? "Generate an SDK key for the LangWatch CLI"
                  : "Authorize the LangWatch CLI"}
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack align="stretch" gap={6}>
              {!userCode && (
                <Alert.Root status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>No code provided</Alert.Title>
                    <Alert.Description>
                      Run <code>langwatch login</code> in your terminal, it
                      will print a link with your code embedded.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              {userCode && lookup.kind === "loading" && (
                <HStack>
                  <Spinner size="sm" />
                  <Text>Looking up code…</Text>
                </HStack>
              )}

              {lookup.kind === "expired" && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Code expired</Alert.Title>
                    <Alert.Description>
                      Restart <code>langwatch login</code> in your terminal to
                      get a new code.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              {lookup.kind === "error" && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Something went wrong</Alert.Title>
                    <Alert.Description>{lookup.message}</Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              {lookup.kind === "ready" && action.kind !== "success" && action.kind !== "denied" && (
                <>
                  <Text fontSize="sm" color="gray.600">
                    {requiresProject
                      ? "The CLI is requesting a project SDK API key. Pick the project to mint a key for; the key will flow back to your terminal automatically — no copy-paste."
                      : "The CLI is requesting a device session. Approving signs in this device for AI-tool wrappers (Claude, Codex, etc.) and governance commands."}
                  </Text>
                  <Box
                    bg="gray.50"
                    borderRadius="md"
                    p={4}
                    fontFamily="mono"
                    fontSize="2xl"
                    fontWeight="bold"
                    textAlign="center"
                    letterSpacing="0.2em"
                  >
                    {lookup.userCode}
                  </Box>
                  <Text fontSize="sm" color="gray.600" textAlign="center">
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
                      <Text fontWeight="medium" mb={2}>
                        Organization
                      </Text>
                      <VStack align="stretch" gap={2}>
                        {organizations.map((org) => (
                          <Button
                            key={org.id}
                            variant={selectedOrgId === org.id ? "solid" : "outline"}
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
                      <Text fontWeight="medium" mb={2}>
                        Project
                      </Text>
                      {projectsForOrg.length === 0 ? (
                        <Alert.Root status="warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Title>No projects yet</Alert.Title>
                            <Alert.Description>
                              Create a project in this organization first, then
                              re-run <code>langwatch login</code> in your
                              terminal.
                            </Alert.Description>
                          </Alert.Content>
                        </Alert.Root>
                      ) : (
                        <VStack align="stretch" gap={2}>
                          {projectsForOrg.map((p) => (
                            <Button
                              key={p.id}
                              variant={
                                selectedProjectId === p.id ? "solid" : "outline"
                              }
                              onClick={() => setSelectedProjectId(p.id)}
                              justifyContent="flex-start"
                              height="auto"
                              paddingY={3}
                            >
                              <VStack align="start" gap={0} width="full">
                                <Text fontWeight="semibold">{p.name}</Text>
                                <Text fontSize="xs" opacity={0.7}>
                                  {p.teamName}
                                </Text>
                              </VStack>
                            </Button>
                          ))}
                        </VStack>
                      )}
                    </Box>
                  )}

                  {action.kind === "error" && (
                    <Alert.Root status="error">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Approval failed</Alert.Title>
                        <Alert.Description>{action.message}</Alert.Description>
                      </Alert.Content>
                    </Alert.Root>
                  )}

                  <Stack direction={{ base: "column", sm: "row" }} gap={3}>
                    <Button
                      colorPalette="blue"
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
                      variant="outline"
                      onClick={handleDeny}
                      loading={action.kind === "submitting"}
                    >
                      Deny
                    </Button>
                  </Stack>
                </>
              )}

              {action.kind === "success" && (
                <Alert.Root status="success">
                  <Alert.Indicator />
                  <Alert.Content>
                    {action.credentialType === "project_api_key" ? (
                      <>
                        <Alert.Title>API key generated!</Alert.Title>
                        <Alert.Description>
                          A fresh project API key has been minted for{" "}
                          <strong>
                            {action.projectName ?? "your project"}
                          </strong>{" "}
                          ({action.organizationName}). The key flowed back to
                          your terminal automatically — your{" "}
                          <code>.env</code> is updated. You can close this tab.
                        </Alert.Description>
                      </>
                    ) : (
                      <>
                        <Alert.Title>You&apos;re signed in!</Alert.Title>
                        <Alert.Description>
                          LangWatch CLI is now authorized for{" "}
                          <strong>{action.organizationName}</strong> using the{" "}
                          <code>{action.vkLabel}</code> personal key. You can
                          close this tab and return to your terminal.
                        </Alert.Description>
                      </>
                    )}
                  </Alert.Content>
                </Alert.Root>
              )}

              {action.kind === "denied" && (
                <Alert.Root status="info">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Authorization denied</Alert.Title>
                    <Alert.Description>
                      The CLI session has been rejected. You can close this tab.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
            </VStack>
          </Card.Body>
        </Card.Root>
      </Container>
    </>
  );
}

function FullPageSpinner() {
  return (
    <Container maxWidth="400px" paddingTop="160px">
      <VStack gap={4}>
        <Spinner size="lg" />
        <Text color="gray.600">Loading…</Text>
      </VStack>
    </Container>
  );
}
