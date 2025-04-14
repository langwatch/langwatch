import {
  Box,
  Button,
  Container,
  HStack,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useState } from "react";
import { PromptConfigTable } from "~/components/prompt-configs/PromptConfigTable";
import { PromptConfigPanel } from "~/components/prompt-configs/PromptConfigPanel";
// You'll need more imports when implementing the drawer/modal, etc.

export default function PromptConfigsPage() {
  const { project } = useOrganizationTeamProject();
  const [isPromptConfigPanelOpen, setIsPromptConfigPanelOpen] = useState(false);

  const handleCreateButtonClick = () => {
    setIsPromptConfigPanelOpen(true);
  };

  return (
    <DashboardLayout>
      <Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        // marginTop={8}
        position="relative"
        height="full"
      >
        <VStack align="start" width="full">
          {/* Header with title and "Create New" button */}
          <HStack width="full" justifyContent="space-between">
            <Heading as="h1" size="lg">
              Prompts
            </Heading>
            <Button
              colorPalette="blue"
              minWidth="fit-content"
              onClick={handleCreateButtonClick}
            >
              <Plus height={16} /> Create New
            </Button>
          </HStack>
        </VStack>
        <PromptConfigTable
          projectSlug={project?.slug || ""}
          configs={[]}
          isLoading={false}
          onViewVersions={() => {}}
          onEditName={() => {}}
          onDelete={() => {}}
        />
        <PromptConfigPanel
          isOpen={isPromptConfigPanelOpen}
          onClose={() => setIsPromptConfigPanelOpen(false)}
          config={{}}
        />

        {/* You'll need to implement drawer/modal components for:
          - Creating a new config
          - Editing a config name
          - Viewing/managing versions
          - Creating a new version
      */}
      </Container>
    </DashboardLayout>
  );
}
