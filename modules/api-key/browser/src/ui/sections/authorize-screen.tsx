// /authorize: mint and copy a personal access token on a standalone branded card; the host lends
// the switcher. Signed out, it sends the reader to sign in and back, as main's DashboardLayout did.

import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { PersonalAccessTokenBanner } from "@langwatch/design-system/personal-access-token-banner";
import {
  Button,
  createListCollection,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { useEffect, useMemo, useState } from "react";

import {
  earliestCustomExpiration,
  EXPIRATION_OPTIONS,
  EXPIRATION_UNCHOSEN,
  isExpirationChosen,
  resolveExpiresAt,
} from "../../model/api-key-form.ts";
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
  const [expirationPreset, setExpirationPreset] = useState(EXPIRATION_UNCHOSEN);
  const [customDate, setCustomDate] = useState("");
  const minCustomDate = useMemo(() => earliestCustomExpiration(), []);
  const expirationCollection = useMemo(
    () => createListCollection({ items: EXPIRATION_OPTIONS }),
    [],
  );
  const expirationChosen = isExpirationChosen({ preset: expirationPreset, customDate });

  const copyKey = async () => {
    if (!expirationChosen) return;
    setIsRevealing(true);
    try {
      const text = await host.mintProjectToken({
        expiresAt: resolveExpiresAt({ preset: expirationPreset, customDate }),
      });
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
    <VStack align="stretch" gap={2}>
      <VStack align="stretch" gap={1}>
        <Text fontSize="sm" color="fg.muted">
          Expiration
        </Text>
        <Select.Root
          collection={expirationCollection}
          value={[expirationPreset]}
          onValueChange={(details) => {
            const value = details.value[0] ?? EXPIRATION_UNCHOSEN;
            setExpirationPreset(value);
            if (value !== "custom") setCustomDate("");
          }}
        >
          <Select.Trigger width="full" background="bg">
            <Select.ValueText placeholder="Choose when this token expires" />
          </Select.Trigger>
          <Select.Content paddingY={2}>
            {EXPIRATION_OPTIONS.map((option) => (
              <Select.Item key={option.value} item={option}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {expirationPreset === "custom" && (
          <Input
            type="date"
            aria-label="Expiry date"
            value={customDate}
            min={minCustomDate}
            onChange={(event) => setCustomDate(event.target.value)}
          />
        )}
        {!expirationChosen && (
          <Text fontSize="xs" color="fg.muted" data-testid="authorize-expiration-hint">
            Choose when this token expires, or select No expiration.
          </Text>
        )}
      </VStack>
      <Button loading={isRevealing} disabled={!expirationChosen} onClick={() => void copyKey()}>
        Create and copy a personal access token
      </Button>
    </VStack>
  );
}
