import {
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { isAllowedRedirectScheme } from "~/mcp/redirectSchemes";
import { useSession } from "~/utils/auth-client";
import { useRouter } from "~/utils/compat/next-router";
import {
  DashboardLayout,
  ProjectSelector,
} from "../../components/DashboardLayout";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Whether a destination is safe to hand to `location`. Every redirect this
 * page follows was verified against the client registry server-side first;
 * this is the second lock, so that a regression on that side is a broken
 * redirect rather than script running on our origin. Shares its list with the
 * authorize route, which applies the same rule before it ever issues a code.
 */
const isNavigableRedirect = isAllowedRedirectScheme;

export default function McpAuthorize() {
  const router = useRouter();
  const { data: session, status } = useSession();

  // Read OAuth params from URL search params (previously from getServerSideProps)
  const oauthParams = {
    response_type: (router.query.response_type as string) ?? "",
    client_id: (router.query.client_id as string) ?? "",
    redirect_uri: (router.query.redirect_uri as string) ?? "",
    state: (router.query.state as string) ?? "",
    code_challenge: (router.query.code_challenge as string) ?? "",
    code_challenge_method: (router.query.code_challenge_method as string) ?? "",
    scope: (router.query.scope as string) ?? "",
  };

  const { organizations, project } = useOrganizationTeamProject();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect to sign-in if not authenticated (previously done in getServerSideProps)
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(oauthParams)) {
        if (value) params.set(key, value);
      }
      const callbackUrl = `/mcp/authorize?${params.toString()}`;
      void router.replace(
        `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
  }, [session, status]);

  if (status === "loading" || !session) return null;

  const showError = (message: string) => {
    toaster.create({
      title: "Authorization failed",
      description: message,
      type: "error",
      meta: { closable: true },
    });
    setIsSubmitting(false);
  };

  const handleAllow = async () => {
    if (!project) return;
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/mcp/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          redirect_uri: oauthParams.redirect_uri,
          state: oauthParams.state,
          code_challenge: oauthParams.code_challenge,
          code_challenge_method: oauthParams.code_challenge_method,
          client_id: oauthParams.client_id,
        }),
      });

      const data = await response.json();

      // A failure the server could attribute to this client comes back with a
      // redirect that carries the OAuth error, so the waiting application is
      // told what went wrong instead of hanging on a popup. Failures it could
      // not attribute have no safe destination and are shown here.
      if (data.redirect) {
        if (!isNavigableRedirect(data.redirect)) {
          showError("The application asked to return to an unusable address");
          return;
        }
        window.location.href = data.redirect;
        return;
      }

      if (!response.ok) {
        // RFC 6749 §4.1.2.1 wire fields from our own authorize endpoint, not a
        // mutation error: the copy is written for the customer at the point it
        // is produced, so there is no error code to look up here.
        showError(data.error_description ?? data.error ?? "Unknown error");
        return;
      }

      showError("No redirect URL received from server");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Network error");
    }
  };

  const handleDeny = () => {
    if (oauthParams.redirect_uri) {
      if (!isNavigableRedirect(oauthParams.redirect_uri)) {
        void router.push("/");
        return;
      }
      const url = new URL(oauthParams.redirect_uri);
      url.searchParams.set("error", "access_denied");
      if (oauthParams.state) {
        url.searchParams.set("state", oauthParams.state);
      }
      window.location.href = url.toString();
    } else {
      void router.push("/");
    }
  };

  const scopeDisplay = oauthParams.scope || "mcp:tools";

  return (
    <DashboardLayout>
      <Container maxWidth="600px" paddingTop="200px">
        <Card.Root>
          <Card.Header>
            <HStack width="full" align="center">
              <Heading as="h1" size="md">
                Authorize MCP Connection
              </Heading>
              <Spacer />
              {organizations && project && (
                <ProjectSelector
                  organizations={organizations}
                  project={project}
                />
              )}
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack align="start" gap={6}>
              <Text>
                Allow this application to access your LangWatch project tools
                and data?
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Scopes: {scopeDisplay}
              </Text>
              <HStack width="full" gap={2}>
                <Button
                  colorScheme="blue"
                  onClick={handleAllow}
                  disabled={!project || isSubmitting}
                  loading={isSubmitting}
                >
                  Allow
                </Button>
                <Button variant="outline" onClick={handleDeny}>
                  Deny
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </Container>
    </DashboardLayout>
  );
}
