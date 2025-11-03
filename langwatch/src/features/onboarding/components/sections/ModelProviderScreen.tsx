import React from "react";
import { VStack, Grid, Box, Button, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useRouter } from "next/router";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { ArrowRight } from "react-feather";

export function ModelProviderScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();

  return (
    <>
      <Grid templateColumns={{ base: "1fr", "xl": "1fr 1fr" }} gap={{ base: 6, "xl": 32 }} alignItems="start" mb={20}>
        <VStack align="stretch" gap={6}>

        </VStack>

        <VStack align="stretch" gap={3} minW={0} w="full">

        </VStack>
      </Grid>

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Tooltip content="Continue to LangWatch — skip onboarding" positioning={{ placement: "left" }} showArrow openDelay={0}>
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              aria-label="Continue to LangWatch"
              borderRadius="full"
              variant="ghost"
              colorPalette="gray"
              bg="whiteAlpha.50"
              _hover={{ bg: "whiteAlpha.100", transform: "translateY(-1px)" }}
              borderWidth="1px"
              borderColor="whiteAlpha.200"
              backdropFilter="blur(10px)"
              style={{ WebkitBackdropFilter: "blur(10px)" }}
              boxShadow="0 4px 18px rgba(2, 1, 1, 0.14), inset 0 1px 0 rgba(255,255,255,0.18)"
              px={{ base: 2, md: 4 }}
              py={2}
            >
              <HStack gap={{ base: 0, md: 2 }}>
                <Text display={{ base: "none", md: "inline" }}>Continue to LangWatch</Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
