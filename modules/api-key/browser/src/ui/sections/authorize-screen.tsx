// /authorize: copy the project API key on a standalone branded card; the host lends the
// switcher. Signed out, it sends the reader to sign in and back, as main's DashboardLayout did.

import { HStack, Text, VStack } from "@chakra-ui/react";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { useEffect, useState } from "react";

import { useAuthorizeHost } from "../../model/authorize-host.ts";
import { CopyInput } from "../elements/copy-input.tsx";

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
        intro="Copy your LangWatch API key and paste it into your command line or notebook to authorize it."
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
  return <CopyInput value={host.revealProjectApiKey() ?? ""} label="API key" onCopied={onCopied} />;
}
