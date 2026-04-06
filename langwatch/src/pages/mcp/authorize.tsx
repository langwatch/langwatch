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
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  DashboardLayout,
  ProjectSelector,
} from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getServerAuthSession } from "../../server/auth";

interface McpAuthorizeProps {
  oauthParams: {
    response_type: string;
    client_id: string;
    redirect_uri: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
    scope: string;
  };
}

export const getServerSideProps: GetServerSideProps<McpAuthorizeProps> = async (
  context,
) => {
  const session = await getServerAuthSession(context);

  const oauthParams = {
    response_type: (context.query.response_type as string) ?? "",
    client_id: (context.query.client_id as string) ?? "",
    redirect_uri: (context.query.redirect_uri as string) ?? "",
    state: (context.query.state as string) ?? "",
    code_challenge: (context.query.code_challenge as string) ?? "",
    code_challenge_method: (context.query.code_challenge_method as string) ?? "",
    scope: (context.query.scope as string) ?? "",
  };

  if (!session) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(oauthParams)) {
      if (value) {
        params.set(key, value);
      }
    }
    const callbackUrl = `/mcp/authorize?${params.toString()}`;

    return {
      redirect: {
        destination: `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        permanent: false,
      },
    };
  }

  return {
    props: {
      oauthParams,
    },
  };
};

export default function McpAuthorize({ oauthParams }: McpAuthorizeProps) {
  const { organizations, project } = useOrganizationTeamProject();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      if (response.redirected) {
        window.location.href = response.url;
        return;
      }

      const data = await response.json();
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleDeny = () => {
    if (oauthParams.redirect_uri) {
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
              <HStack width="full" gap={4}>
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
