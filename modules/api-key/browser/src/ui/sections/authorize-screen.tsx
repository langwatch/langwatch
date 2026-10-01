// /authorize: mint and copy a personal access token on a standalone branded card; the host lends
// the switcher. Signed out, it sends the reader to sign in and back, as main's DashboardLayout did.

import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { PersonalAccessTokenBanner } from "@langwatch/design-system/personal-access-token-banner";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";

import { useAuthorizeHost } from "../../model/authorize-host.ts";

export default function Authorize() {
  const host = useAuthorizeHost();
  const status = host.sessionStatus();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    host.replace(`/auth/signin?callbackUrl=${encodeURIComponent("/authorize")}`);
  }, [status, host]);

  if (status !== "authenticated") return null;

  return (
    <BrandedCardPage>
      <BrandedCard
        title="Authorize"
        intro="Create a LangWatch personal access token and paste it into your command line or notebook to authorize it."
      >
        <HStack width="full" justify="space-between">
          <Text fontSize="sm" color="fg.muted">
            Project
          </Text>
          {host.projectSwitcher()}
        </HStack>
        <VStack align="stretch" gap={2}>
          <APIKeyCopyInput onCopied={() => setCopied(true)} />
          {copied ? (
            <Text fontSize="sm" color="fg.muted" textAlign="center">
              You can close this tab once you have pasted it.
            </Text>
          ) : null}
        </VStack>
      </BrandedCard>
    </BrandedCardPage>
  );
}

export function APIKeyCopyInput({ onCopied }: { onCopied?: () => void }) {
  const host = useAuthorizeHost();
  const [isRevealing, setIsRevealing] = useState(false);
  // A failed copy (Safari after an await) keeps the token on screen to copy by hand.
  const projectId = host.scope().projectId;
  const [uncopied, setUncopied] = useState<{ projectId: string | undefined; token: string }>();
  const shown = uncopied && uncopied.projectId === projectId ? uncopied.token : undefined;

  const copyKey = async () => {
    setIsRevealing(true);
    try {
      const text = await host.mintProjectToken();
      if (!text) return;
      const copied = await host.copyToClipboard({
        text,
        succeeded: { title: "Personal access token copied to clipboard" },
      });
      if (copied) onCopied?.();
      else setUncopied({ projectId, token: text });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't create the personal access token" });
    } finally {
      setIsRevealing(false);
    }
  };

  if (shown) {
    return (
      <PersonalAccessTokenBanner
        token={shown}
        isCreating={isRevealing}
        onCreate={() => void copyKey()}
      />
    );
  }

  return (
    <Button loading={isRevealing} onClick={() => void copyKey()}>
      Create and copy a personal access token
    </Button>
  );
}
