import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type React from "react";
import { useState } from "react";
import { ArrowRight } from "react-feather";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import type { ModelProviderKey } from "../../regions/model-providers/types";
import { ModelProviderGrid } from "./model-provider/ModelProviderGrid";
import { ModelProviderSetup } from "./model-provider/ModelProviderSetup";

interface ModelProviderScreenProps {
  variant: "evaluations" | "prompts";
}

export const ModelProviderScreen: React.FC<ModelProviderScreenProps> = ({
  variant,
}) => {
  const router = useRouter();
  const { project } = useActiveProject();
  const [modelProviderKey, setSelectedModelProviderKey] =
    useState<ModelProviderKey>("open_ai");

  return (
    <>
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
        />
      </VStack>

    </>
  );
};
