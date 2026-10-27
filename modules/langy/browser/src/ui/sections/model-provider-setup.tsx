/**
 * The model-provider setup Langy embeds when the project has none: pick a
 * provider, paste a key, save, and the panel re-resolves the model in place.
 * Spec: specs/langy/langy-inline-model-setup.feature
 */
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";
import { useRef, useState } from "react";

import { LentEditModelProviderForm } from "../../behavior/lent-edit-model-provider-form.tsx";
import { useLangyHost } from "../../model/langy-host.ts";
import {
  langyModelProviders,
  LANGY_MODEL_SETUP_DESCRIPTION,
  LANGY_RECOMMENDED_PROVIDER,
} from "../../model/langy-model-providers.ts";
import { LangyProviderCard } from "../elements/langy-provider-card.tsx";

export type ModelProviderKey = string;

const REVEAL_MAX_FRAMES = 60;

export function LangyModelProviderSetup({
  onComplete,
  initialProviderKey,
}: {
  /** Called once the credential is stored, so the panel can re-resolve. */
  onComplete?: () => void;
  /** Land on this provider: "sign in to Codex again" opens straight on codex. */
  initialProviderKey?: ModelProviderKey;
}) {
  const host = useLangyHost();
  const project = host.project();
  const organization = host.organization();
  const providers = langyModelProviders();

  const [providerKey, setProviderKey] = useState<ModelProviderKey>(
    () => initialProviderKey ?? providers[0]?.provider ?? LANGY_RECOMMENDED_PROVIDER,
  );

  // The key fields sit below the fold of the cards in this narrow column: picking a provider
  // focuses the first field and scrolls the form into view, or the click seems to do nothing.
  // The lent form mounts a few frames after the pick, so the reveal waits for its controls.
  const setupRef = useRef<HTMLDivElement | null>(null);
  const revealSetup = (framesLeft: number) => {
    const setup = setupRef.current;
    if (!setup) return;
    if (!setup.querySelector("input, select, textarea, button") && framesLeft > 0) {
      requestAnimationFrame(() => revealSetup(framesLeft - 1));
      return;
    }
    setup.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
    setup.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const selectProvider = (key: ModelProviderKey) => {
    setProviderKey(key);
    requestAnimationFrame(() => revealSetup(REVEAL_MAX_FRAMES));
  };

  return (
    <VStack align="stretch" gap={6} marginBottom={20}>
      <VStack align="stretch" gap={3}>
        <Text fontSize="xs" color="fg.muted">
          {LANGY_MODEL_SETUP_DESCRIPTION}
        </Text>
        <HStack as="fieldset" gap={2} wrap="wrap" minW={0} aria-label="Model provider">
          {providers.map((provider) => (
            <LangyProviderCard
              key={provider.provider}
              label={provider.name}
              mark={modelProviderIcons[provider.provider as keyof typeof modelProviderIcons]}
              selected={provider.provider === providerKey}
              badge={provider.recommended ? "Recommended" : undefined}
              onClick={() => selectProvider(provider.provider)}
            />
          ))}
        </HStack>
      </VStack>

      <Box ref={setupRef} scrollMarginTop="12px">
        <LentEditModelProviderForm
          key={providerKey}
          providerKey={providerKey}
          modelProviderId="new"
          organizationId={organization?.id}
          projectId={project?.id}
          embedded
          onSaved={() => onComplete?.()}
        />
      </Box>
    </VStack>
  );
}
