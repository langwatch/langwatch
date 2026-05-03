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

type LookupState =
  | { kind: "loading" }
  | {
      kind: "ready";
      userCode: string;
      status: string;
      expiresAt: number;
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

  // Auto-pick the first org if there's only one. The chooser is only
  // necessary when the user is in 2+.
  useEffect(() => {
    if (organizations && organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0]!.id);
    }
  }, [organizations, selectedOrgId]);

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
        };
        setLookup({
          kind: "ready",
          userCode: data.user_code,
          status: data.status,
          expiresAt: data.expires_at,
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

  const handleApprove = async () => {
    if (!selectedOrgId || !userCode) return;
    setAction({ kind: "submitting" });
    try {
      const r = await fetch("/api/auth/cli/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: userCode,
          organization_id: selectedOrgId,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        personal_vk_label?: string;
        error_description?: string;
      };
      if (!r.ok) {
        setAction({
          kind: "error",
          message: data.error_description ?? `Approval failed (${r.status})`,
        });
        return;
      }
      const orgName =
        organizations?.find((o) => o.id === selectedOrgId)?.name ??
        "your organization";
      setAction({
        kind: "success",
        vkLabel: data.personal_vk_label ?? "default",
        organizationName: orgName,
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
                Authorize the LangWatch CLI
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
                      Run <code>langwatch login</code> in your terminal — it
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
                    {expiryText ? ` ${expiryText}.` : ""}
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
                      disabled={!selectedOrgId}
                    >
                      Approve
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
                    <Alert.Title>You're signed in!</Alert.Title>
                    <Alert.Description>
                      LangWatch CLI is now authorized for{" "}
                      <strong>{action.organizationName}</strong> using the{" "}
                      <code>{action.vkLabel}</code> personal key. You can close
                      this tab and return to your terminal.
                    </Alert.Description>
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
