/**
 * Grant an MCP client access to a project. Redirect allowlist is unchanged
 * (security-critical second lock); wire and frame changed per port architecture.
 */

import { Button, Card, Container, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import {
  useAuthorizeHost,
  type AuthorizeRouteReading,
  type McpAuthorizeAnswer,
} from "../../model/authorize-host.ts";
import { isAllowedRedirectScheme } from "../../model/redirect-schemes.ts";

type OAuthParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
};

type AllowOutcome = { kind: "handOff"; url: string } | { kind: "refuse"; message: string };

function oauthParamsFrom(query: AuthorizeRouteReading["query"]): OAuthParams {
  return {
    response_type: query.response_type ?? "",
    client_id: query.client_id ?? "",
    redirect_uri: query.redirect_uri ?? "",
    state: query.state ?? "",
    code_challenge: query.code_challenge ?? "",
    code_challenge_method: query.code_challenge_method ?? "",
    scope: query.scope ?? "",
  };
}

function signInPathFor(oauthParams: OAuthParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(oauthParams)) {
    if (value) params.set(key, value);
  }
  const callbackUrl = `/mcp/authorize?${params.toString()}`;
  return `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

/** A redirect is the server's answer; the scheme check is the second lock (see file header). */
function allowOutcomeOf(answer: McpAuthorizeAnswer): AllowOutcome {
  if (answer.redirect) {
    return isAllowedRedirectScheme(answer.redirect)
      ? { kind: "handOff", url: answer.redirect }
      : { kind: "refuse", message: "The application asked to return to an unusable address" };
  }
  // RFC 6749 §4.1.2.1 fields: customer copy written where produced, no code to look up.
  if (!answer.ok) {
    return { kind: "refuse", message: answer.error_description ?? answer.error ?? "Unknown error" };
  }
  return { kind: "refuse", message: "No redirect URL received from server" };
}

function denialRedirectFor(oauthParams: OAuthParams): string | undefined {
  const target = oauthParams.redirect_uri;
  if (!target || !isAllowedRedirectScheme(target)) return undefined;
  const url = new URL(target);
  url.searchParams.set("error", "access_denied");
  if (oauthParams.state) url.searchParams.set("state", oauthParams.state);
  return url.toString();
}

export default function McpAuthorize() {
  const host = useAuthorizeHost();
  const status = host.sessionStatus();
  const reading = host.route();
  const { projectId } = host.scope();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The OAuth parameters ride the query string; the platform page read them the
  // same way after `getServerSideProps` went away.
  const oauthParams = oauthParamsFrom(reading.query);

  // Sign in first, carrying the whole consent request through, so the reader
  // lands back on the grant they were asked for rather than on a home page.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    host.replace(signInPathFor(oauthParams));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") return null;

  /**
   * The `error` is deliberately `undefined` here: every sentence is written
   * at the point it's produced — RFC 6749 §4.1.2.1 fields, or a refusal this
   * screen made — so there's no code to look up; `description` is the whole message.
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
      const outcome = allowOutcomeOf(answer);
      if (outcome.kind === "handOff") host.handOffTo(outcome.url);
      else showError(outcome.message);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Network error");
    }
  };

  const handleDeny = () => {
    const url = denialRedirectFor(oauthParams);
    if (url) host.handOffTo(url);
    else host.navigate("/");
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
            <Text>Allow this application to access your LangWatch project tools and data?</Text>
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
