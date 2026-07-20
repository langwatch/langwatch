import { Box, VStack } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import type {
  ModelProviderKey,
  ModelProviderSurface,
} from "../../regions/model-providers/types";
import {
  ModelProviderGrid,
  providersForSurface,
} from "./model-provider/ModelProviderGrid";
import { ModelProviderSetup } from "./model-provider/ModelProviderSetup";

interface ModelProviderScreenProps {
  variant: ModelProviderSurface;
  /**
   * Called after the provider is saved, instead of the default
   * redirect-to-feature behavior. Used when the screen is embedded in a
   * surface that stays on the page (e.g. the Langy panel) and just wants to
   * re-resolve the model rather than navigate away.
   */
  onComplete?: () => void;
  /**
   * Land on this provider instead of the surface's first grid entry — e.g.
   * Langy's "sign in to Codex again" card opens the screen straight on codex.
   */
  initialProviderKey?: ModelProviderKey;
}

export const ModelProviderScreen: React.FC<ModelProviderScreenProps> = ({
  variant,
  onComplete,
  initialProviderKey,
}) => {
  // The surface's leading provider is the default selection — on surfaces
  // with a recommended provider (Codex on Langy setup / onboarding) that is
  // the recommendation itself.
  const [modelProviderKey, setSelectedModelProviderKey] =
    useState<ModelProviderKey>(
      () =>
        initialProviderKey ??
        providersForSurface(variant)[0]?.key ??
        "open_ai",
    );

  // In the Langy panel the screen lives in a narrow scrolling column, and the
  // credential form sits below the fold of the provider grid: picking a
  // provider must bring the key fields into view, focused on the first one,
  // or the click appears to do nothing. Driven from the click (not an effect
  // on the selection) so re-picking the already-selected provider scrolls
  // too. The rAF lets the remounted form lay out first; focus goes first with
  // preventScroll so the smooth scroll owns the motion.
  const setupRef = useRef<HTMLDivElement | null>(null);
  const handleSelectModelProvider = useCallback(
    (key: ModelProviderKey) => {
      setSelectedModelProviderKey(key);
      if (variant !== "langy") return;
      requestAnimationFrame(() => {
        const setup = setupRef.current;
        if (!setup) return;
        setup
          .querySelector<HTMLElement>("input, select, textarea")
          ?.focus({ preventScroll: true });
        setup.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [variant],
  );

  return (
    <VStack align="stretch" gap={6} mb={20}>
      <ModelProviderGrid
        variant={variant}
        modelProviderKey={modelProviderKey}
        onSelectModelProvider={handleSelectModelProvider}
      />

      <Box ref={setupRef} scrollMarginTop="12px">
        <ModelProviderSetup
          key={modelProviderKey}
          modelProviderKey={modelProviderKey}
          variant={variant}
          onComplete={onComplete}
        />
      </Box>
    </VStack>
  );
};
