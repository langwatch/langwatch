import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { LuPanelLeft, LuPanelLeftOpen } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { LogoIcon } from "../../icons/LogoIcon";
import { Dialog } from "../../ui/dialog";
import { Tooltip } from "../../ui/tooltip";
import { WizardWorkspace } from "./WizardWorkspace";
import { WizardProvider } from "./hooks/useWizardContext";
import { WizardSidebar } from "./EvaluationWizardSidebar";
import { PostEventProvider } from "../../../optimization_studio/hooks/usePostEvent";

export function EvaluationWizard({ isLoading }: { isLoading: boolean }) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const [sidebarVisible, setSidebarVisible] = useState(true);

  const { name, workflowId } = useEvaluationWizardStore(
    useShallow((state) => {
      return {
        name: state.wizardState.name,
        workflowId: state.getDSL().workflow_id,
      };
    })
  );

  const { isAutosaving } = useEvaluationWizardStore(
    useShallow((state) => {
      // For easier debugging
      if (typeof window !== "undefined") {
        // @ts-ignore
        window.state = state;
      }

      return {
        isAutosaving: state.isAutosaving,
      };
    })
  );

  return (
    <ReactFlowProvider>
      <WizardProvider isInsideWizard={true}>
        <PostEventProvider>
          <Dialog.Content width="full" height="full" minHeight="fit-content">
            <Dialog.CloseTrigger />
            <Dialog.Header
              background="white"
              paddingLeft={2}
              paddingY={0}
              display="flex"
            >
              <HStack
                width="full"
                justifyContent="start"
                minWidth="500px"
                maxWidth="500px"
                paddingLeft={2}
                paddingRight={4}
                gap={4}
              >
                <Box
                  role="button"
                  onClick={() =>
                    void router.push(`/${project?.slug}/evaluations`)
                  }
                  cursor="pointer"
                  paddingY={3}
                >
                  <LogoIcon width={24} height={24} />
                </Box>
                <Text fontSize="13px" fontWeight="medium">
                  {name}
                </Text>
                {isAutosaving && (
                  <Tooltip content="Saving changes...">
                    <Box>
                      <Spinner size="sm" />
                    </Box>
                  </Tooltip>
                )}
                {sidebarVisible && <Spacer />}
                <Tooltip
                  content={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                  openDelay={0}
                >
                  <Button
                    variant="ghost"
                    onClick={() => setSidebarVisible(!sidebarVisible)}
                    _icon={{
                      color: "gray.600",
                    }}
                  >
                    {sidebarVisible ? <LuPanelLeft /> : <LuPanelLeftOpen />}
                  </Button>
                </Tooltip>
              </HStack>
              <HStack width="full" justifyContent="center" paddingLeft={8}>
                <Heading as="h1" size="sm" fontWeight="normal">
                  Evaluation Wizard
                </Heading>
              </HStack>
              <HStack justifyContent="end" paddingRight={5} />
            </Dialog.Header>
            <Dialog.Body
              display="flex"
              minHeight="fit-content"
              background="white"
              width="full"
              padding={0}
            >
              {sidebarVisible && <WizardSidebar isLoading={isLoading} />}
              <WizardWorkspace />
            </Dialog.Body>
          </Dialog.Content>
        </PostEventProvider>
      </WizardProvider>
    </ReactFlowProvider>
  );
}
