/**
 * `/connect/docs`: the docs playground's consent popup (ADR-185). A member lets one registered
 * docs site act as them in one project for five minutes. The key is posted only to the session
 * frame that opened the popup, at this app's own origin, never to the docs page.
 */

import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { Box, Button, HStack, Stack, Text, VStack } from "@langwatch/design-system/primitives";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuthorizeHost } from "../../model/authorize-host.ts";
import {
  deniedMessage,
  grantedMessage,
  readDocsConnectRequest,
  type DocsConnectRefusal,
} from "../../model/docs-connect.ts";
import { StatusCard } from "../blocks/status-card.tsx";

/** Each refusal in words a reader acts on. No key is minted on any of them. */
const REFUSAL_COPY: Readonly<Record<DocsConnectRefusal, string>> = {
  "malformed-request": "The link that opened this page is incomplete. Start again from the docs.",
  "origin-not-registered":
    "This site is not registered to connect to LangWatch, so it cannot use your account.",
  impersonating: "You are acting as another member, so you cannot hand their access to the docs.",
  "no-opener": "Open this page from the docs' Use my LangWatch account button.",
};

function signInPathFor(query: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const key of ["origin", "state"] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }

  return `/auth/signin?callbackUrl=${encodeURIComponent(`/connect/docs?${params.toString()}`)}`;
}

export default function DocsConnect() {
  const host = useAuthorizeHost();
  const status = host.sessionStatus();
  const { query } = host.route();
  const { projectId } = host.scope();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    host.replace(signInPathFor(query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") return null;

  const request = readDocsConnectRequest({ query, registered: host.docsOrigins() });
  const opener = host.docsOpener();
  let refusal: DocsConnectRefusal | null = null;
  if (request.kind === "refused") refusal = request.reason;
  else if (host.actingAsAnother()) refusal = "impersonating";
  else if (!opener) refusal = "no-opener";

  if (refusal || request.kind !== "valid" || !opener) {
    return (
      <BrandedCardPage>
        <BrandedCard
          title="This site can't connect to LangWatch"
          intro={REFUSAL_COPY[refusal ?? "malformed-request"]}
        />
      </BrandedCardPage>
    );
  }

  const handleAllow = async () => {
    if (!projectId) return;
    setIsSubmitting(true);
    try {
      const minted = await host.mintDocsSessionKey({ projectId, docsOrigin: request.origin });
      opener.post({
        message: grantedMessage({ state: request.state, minted }),
        targetOrigin: host.appOrigin(),
      });
      host.closeWindow();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Could not connect the docs" });
      setIsSubmitting(false);
    }
  };

  const handleDeny = () => {
    opener.post({
      message: deniedMessage({ state: request.state }),
      targetOrigin: host.appOrigin(),
    });
    host.closeWindow();
  };

  return (
    <BrandedCardPage>
      <BrandedCard
        title="Connect the docs to LangWatch"
        intro="The API playground asks to send requests as you."
      >
        <VStack align="stretch" gap={6}>
          <VStack align="stretch" gap={2}>
            <Box
              bg="bg.subtle"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              p={4}
              fontFamily="mono"
              fontSize="sm"
              fontWeight="medium"
              textAlign="center"
              color="fg"
              overflowWrap="anywhere"
            >
              {new URL(request.origin).host}
            </Box>
            <Text textStyle="xs" color="fg.muted" textAlign="center">
              Allow only if this is the site you opened the playground on.
            </Text>
          </VStack>
          <HStack width="full" justify="space-between">
            <Text textStyle="sm" color="fg.muted">
              Project
            </Text>
            {host.projectSwitcher()}
          </HStack>
          <StatusCard palette="blue" icon={Clock3} title="Access ends after 5 minutes">
            It may do anything you can do in this project, until then or until you sign out.
          </StatusCard>
          <Stack direction={{ base: "column", sm: "row" }} gap={3}>
            <Button
              colorPalette="orange"
              flex={1}
              onClick={handleAllow}
              disabled={!projectId || isSubmitting}
              loading={isSubmitting}
            >
              Allow
            </Button>
            <Button
              variant="outline"
              color="fg.muted"
              borderColor="border.emphasized"
              onClick={handleDeny}
              disabled={isSubmitting}
            >
              Deny
            </Button>
          </Stack>
        </VStack>
      </BrandedCard>
    </BrandedCardPage>
  );
}
