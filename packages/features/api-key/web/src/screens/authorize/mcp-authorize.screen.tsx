/**
 * `/mcp/authorize` — grant an MCP client access to a project.
 *
 * THE REDIRECT ALLOWLIST IS UNCHANGED, byte for byte, and that is the point of
 * keeping `model/redirect-schemes` inside this package rather than behind the
 * host port: it is the SECOND lock behind the server's own client-registry
 * check, and a lock a different composition could answer differently is not a
 * lock. Both call sites are here — the redirect the server hands back, and the
 * `redirect_uri` a denial bounces off — exactly as the platform page had them.
 *
 * What did change is the wire and the frame. The POST to `/api/mcp/authorize` is
 * a REST exchange with an MCP client waiting on the other side, so it lives in
 * `apps/ui/src/behavior` where a browser transport belongs and reaches this
 * screen as `authorizeMcpClient()` — the same shape the `/cli/auth` device flow
 * took. `DashboardLayout` is the chrome layout route's, and the project switcher
 * in the header — which is HOW a reader chooses what is being granted — arrives
 * as a `ReactNode` off the port.
 */

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
import { isAllowedRedirectScheme } from "../../model/redirect-schemes";
import { useAuthorizeHost } from "../../model/authorize-host";

export default function McpAuthorize() {
  const host = useAuthorizeHost();
  const status = host.sessionStatus();
  const reading = host.route();
  const { projectId } = host.scope();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The OAuth parameters ride the query string; the platform page read them the
  // same way after `getServerSideProps` went away.
  const oauthParams = {
    response_type: reading.query.response_type ?? "",
    client_id: reading.query.client_id ?? "",
    redirect_uri: reading.query.redirect_uri ?? "",
    state: reading.query.state ?? "",
    code_challenge: reading.query.code_challenge ?? "",
    code_challenge_method: reading.query.code_challenge_method ?? "",
    scope: reading.query.scope ?? "",
  };

  // Sign in first, carrying the whole consent request through, so the reader
  // lands back on the grant they were asked for rather than on a home page.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(oauthParams)) {
      if (value) params.set(key, value);
    }
    const callbackUrl = `/mcp/authorize?${params.toString()}`;
    host.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") return null;

  /**
   * The `error` is deliberately `undefined` here.
   *
   * Every sentence this screen shows is written at the point it is produced —
   * RFC 6749 §4.1.2.1 wire fields from our own authorize endpoint, or a refusal
   * this screen made about an unusable redirect — so there is no code for a
   * presentation registry to look up, and `description` is the whole message.
   */
  const showError = (message: string) => {
    host.failed({
      error: void 0,
      fallbackTitle: "Authorization failed",
      description: message,
    });
    setIsSubmitting(false);
  };

  const handleAllow = async () => {
    if (!projectId) return;
    setIsSubmitting(true);

    try {
      const answer = await host.authorizeMcpClient({
        projectId,
        redirect_uri: oauthParams.redirect_uri,
        state: oauthParams.state,
        code_challenge: oauthParams.code_challenge,
        code_challenge_method: oauthParams.code_challenge_method,
        client_id: oauthParams.client_id,
      });

      // A failure the server could attribute to this client comes back with a
      // redirect that carries the OAuth error, so the waiting application is
      // told what went wrong instead of hanging on a popup. Failures it could
      // not attribute have no safe destination and are shown here.
      if (answer.redirect) {
        // The server verified this against the client registry before sending
        // it, so this is the second lock: a regression there becomes a broken
        // redirect rather than script running on our origin.
        if (!isAllowedRedirectScheme(answer.redirect)) {
          showError("The application asked to return to an unusable address");
          return;
        }
        host.handOffTo(answer.redirect);
        return;
      }

      if (!answer.ok) {
        // RFC 6749 §4.1.2.1 wire fields from our own authorize endpoint, not a
        // mutation error: the copy is written for the customer at the point it
        // is produced, so there is no error code to look up here.
        showError(answer.error_description ?? answer.error ?? "Unknown error");
        return;
      }

      showError("No redirect URL received from server");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Network error");
    }
  };

  const handleDeny = () => {
    if (oauthParams.redirect_uri) {
      if (!isAllowedRedirectScheme(oauthParams.redirect_uri)) {
        host.navigate("/");
        return;
      }
      const url = new URL(oauthParams.redirect_uri);
      url.searchParams.set("error", "access_denied");
      if (oauthParams.state) {
        url.searchParams.set("state", oauthParams.state);
      }
      host.handOffTo(url.toString());
    } else {
      host.navigate("/");
    }
  };

  const scopeDisplay = oauthParams.scope || "mcp:tools";

  return (
    <Container maxWidth="600px" paddingTop="200px">
      <Card.Root>
        <Card.Header>
          <HStack width="full" align="center">
            <Heading as="h1" size="md">
              Authorize MCP Connection
            </Heading>
            <Spacer />
            {host.projectSwitcher()}
          </HStack>
        </Card.Header>
        <Card.Body>
          <VStack align="start" gap={6}>
            <Text>
              Allow this application to access your LangWatch project tools and data?
            </Text>
            <Text fontSize="sm" color="fg.muted">
              Scopes: {scopeDisplay}
            </Text>
            <HStack width="full" gap={2}>
              <Button
                colorScheme="blue"
                onClick={handleAllow}
                disabled={!projectId || isSubmitting}
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
  );
}
