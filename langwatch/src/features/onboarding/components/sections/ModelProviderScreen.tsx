import React, { useState } from "react";
import { VStack, Box, Button, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useRouter } from "next/router";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { ArrowRight } from "react-feather";
import { ModelProviderGrid } from "./model-provider/ModelProviderGrid";
import { ModelProviderSetup } from "./model-provider/ModelProviderSetup";
import type { ModelProviderKey } from "../../regions/model-providers/types";

interface ModelProviderScreenProps {
  redirectTarget: "evaluations" | "prompts";
}

export const ModelProviderScreen: React.FC<ModelProviderScreenProps> = ({
  redirectTarget,
}) => {
  const router = useRouter();
  const { project } = useActiveProject();
  const [modelProviderKey, setSelectedModelProviderKey] =
    useState<ModelProviderKey>("open_ai");

  return (
    <>
      <VStack align="stretch" gap={6} mb={20}>
        <ModelProviderGrid
          modelProviderKey={modelProviderKey}
          onSelectModelProvider={setSelectedModelProviderKey}
        />

        <ModelProviderSetup
          key={modelProviderKey}
          modelProviderKey={modelProviderKey}
          redirectTarget={redirectTarget}
        />
      </VStack>

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Tooltip
            content="Continue to LangWatch — skip onboarding"
            positioning={{ placement: "left" }}
            showArrow
            openDelay={0}
          >
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              aria-label="Continue to LangWatch"
              borderRadius="full"
              variant="ghost"
              colorPalette="gray"
              bg="bg.emphasized/20"
              _hover={{ bg: "whiteAlpha.100", transform: "translateY(-1px)" }}
              borderWidth="1px"
              borderColor="border.subtle/20"
              backdropFilter="blur(10px)"
              style={{ WebkitBackdropFilter: "blur(10px)" }}
              boxShadow="0 4px 18px rgba(2, 1, 1, 0.14), inset 0 1px 0 rgba(255,255,255,0.18)"
              px={{ base: 2, md: 4 }}
              py={2}
            >
              <HStack gap={{ base: 0, md: 2 }}>
                <Text display={{ base: "none", md: "inline" }}>
                  Continue to LangWatch
                </Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
