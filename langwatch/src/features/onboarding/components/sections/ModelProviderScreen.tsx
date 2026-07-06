import { VStack } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import type { ModelProviderKey } from "../../regions/model-providers/types";
import { ModelProviderGrid } from "./model-provider/ModelProviderGrid";
import { ModelProviderSetup } from "./model-provider/ModelProviderSetup";

interface ModelProviderScreenProps {
  variant: "evaluations" | "prompts" | "langy";
  /**
   * Called after the provider is saved, instead of the default
   * redirect-to-feature behavior. Used when the screen is embedded in a
   * surface that stays on the page (e.g. the Langy panel) and just wants to
   * re-resolve the model rather than navigate away.
   */
  onComplete?: () => void;
}

export const ModelProviderScreen: React.FC<ModelProviderScreenProps> = ({
  variant,
  onComplete,
}) => {
  const [modelProviderKey, setSelectedModelProviderKey] =
    useState<ModelProviderKey>("open_ai");

  return (
    <VStack align="stretch" gap={6} mb={20}>
      <ModelProviderGrid
        variant={variant}
        modelProviderKey={modelProviderKey}
        onSelectModelProvider={setSelectedModelProviderKey}
      />

      <ModelProviderSetup
        key={modelProviderKey}
        modelProviderKey={modelProviderKey}
        variant={variant}
        onComplete={onComplete}
      />
    </VStack>
  );
};
