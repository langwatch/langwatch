/**
 * `/connect/docs`: the docs playground's consent popup (ADR-185). A member lets one registered
 * docs site act as them in one project, read-only or fully, for 5 to 60 minutes. The key is
 * posted only to the session frame that opened the popup, at this app's own origin.
 */

import {
  DOCS_SESSION_KEY_LIFETIME_MINUTES,
  docsSessionKeyLifetimeMinutesSchema,
  type DocsSessionKeyAccess,
  type DocsSessionKeyLifetimeMinutes,
} from "@langwatch/api-key-contract";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { Box, Button, HStack, Stack, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuthorizeHost, type DocsOpener } from "../../model/authorize-host.ts";
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
  const [access, setAccess] = useState<DocsSessionKeyAccess>("full");
  const [lifetimeMinutes, setLifetimeMinutes] = useState<DocsSessionKeyLifetimeMinutes>(5);

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

  const availability = host.docsSessionAvailability();
  if (availability === "disabled") {
    return (
      <BrandedCardPage>
        <BrandedCard
          title="Your organisation turned this off"
          intro="Your organisation does not let the docs playground use your account. Paste an API key into the playground instead."
        >
          <Button variant="outline" onClick={handleDenyOf({ host, opener, state: request.state })}>
            Close
          </Button>
        </BrandedCard>
      </BrandedCardPage>
    );
  }

  const handleAllow = async () => {
    if (!projectId) return;
    setIsSubmitting(true);
    try {
      const minted = await host.mintDocsSessionKey({
        projectId,
        docsOrigin: request.origin,
        access,
        lifetimeMinutes,
      });
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

  const handleDeny = handleDenyOf({ host, opener, state: request.state });

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
          <VStack align="stretch" gap={2}>
            <Text textStyle="sm" color="fg.muted">
              What the docs may do
            </Text>
            <RadioGroup
              value={access}
              onValueChange={(details) => setAccess(details.value === "read" ? "read" : "full")}
              data-testid="docs-connect-access"
            >
              <VStack align="stretch" gap={2}>
                <Radio value="full">Everything you can do in this project</Radio>
                <Radio value="read">Read only</Radio>
              </VStack>
            </RadioGroup>
          </VStack>
          <HStack width="full" justify="space-between">
            <Text textStyle="sm" color="fg.muted">
              Access lasts
            </Text>
            <SegmentedControl
              size="xs"
              aria-label="How long access lasts"
              value={String(lifetimeMinutes)}
              onValueChange={(details) => {
                const parsed = docsSessionKeyLifetimeMinutesSchema.safeParse(Number(details.value));
                if (parsed.success) setLifetimeMinutes(parsed.data);
              }}
              items={DOCS_SESSION_KEY_LIFETIME_MINUTES.map((minutes) => ({
                value: String(minutes),
                label: `${minutes} min`,
              }))}
              data-testid="docs-connect-lifetime"
            />
          </HStack>
          <StatusCard
            palette="blue"
            icon={Clock3}
            title={`Access ends after ${lifetimeMinutes} minutes`}
          >
            {access === "read"
              ? "It may read anything you can read in this project, until then or until you sign out."
              : "It may do anything you can do in this project, until then or until you sign out."}
          </StatusCard>
          <Stack direction={{ base: "column", sm: "row" }} gap={3}>
            <Button
              colorPalette="orange"
              flex={1}
              onClick={handleAllow}
              disabled={!projectId || isSubmitting || availability !== "enabled"}
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

/** Deny, and Close on a refusal: the frame hears no key and the popup closes. */
function handleDenyOf({
  host,
  opener,
  state,
}: {
  host: ReturnType<typeof useAuthorizeHost>;
  opener: DocsOpener;
  state: string;
}) {
  return () => {
    opener.post({ message: deniedMessage({ state }), targetOrigin: host.appOrigin() });
    host.closeWindow();
  };
}
