import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type React from "react";
import { ArrowRight } from "react-feather";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

export function ViaClaudeCodeScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();

  return (
    <>
      <VStack align="stretch" gap={6} mb={20}>
        <Text fontSize="sm" color="fg.muted">
          Coming soon — set up LangWatch using Claude Code CLI with prompts,
          skills, or MCP.
        </Text>
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
              bg="bg.panel"
              _hover={{ bg: "bg.muted", transform: "translateY(-1px)" }}
              borderWidth="1px"
              borderColor="border.muted"
              boxShadow="md"
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
