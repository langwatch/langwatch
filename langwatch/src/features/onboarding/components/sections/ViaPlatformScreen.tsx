import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type React from "react";
import { ArrowRight } from "react-feather";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

export function ViaPlatformScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();

  return (
    <>
      <VStack align="stretch" gap={6} mb={20}>
        <Text fontSize="sm" color="fg.muted">
          Coming soon — configure LangWatch directly through the dashboard.
        </Text>
      </VStack>

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Button
            onClick={() => void router.push(`/${project.slug}`)}
            borderRadius="full"
            colorPalette="orange"
            px={{ base: 4, md: 6 }}
            py={2}
            boxShadow="md"
          >
            <HStack gap={2}>
              <Text>Continue to LangWatch</Text>
              <ArrowRight size={16} />
            </HStack>
          </Button>
        </Box>
      )}
    </>
  );
}
