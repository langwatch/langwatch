import { Box, Card } from "@chakra-ui/react";

import { Tabs } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { RenderCode } from "~/components/code/RenderCode";

export function CopilotWorkspace() {
  const { code } = useEvaluationWizardStore(
    useShallow((state) => ({
      code: state.copilotStore.code,
    }))
  );

  if (code === null) return null;

  return (
    <Tabs.Root defaultValue="code" variant={"subtle"} maxHeight={"100vh"}>
      <Card.Root
        variant={"elevated"}
        maxHeight={"calc(100vh - 100px)"} 
        w={"full"}
        blur={"sm"}
        background={"rgb(255 255 255 / 60%)"}
      >
        <Card.Header>
          <Tabs.List borderBottom={"none"} justifyContent={"center"}>
            <Tabs.Trigger value="code">
              Code
            </Tabs.Trigger>
            <Tabs.Trigger disabled value="results">
              Results
            </Tabs.Trigger>
          </Tabs.List>
        </Card.Header>
        <Card.Body pt={0} overflow={"auto"}>
          <Tabs.Content value="code">
            <Box borderRadius={"md"} overflow={"hidden"}>
              <RenderCode
                code={code}
                language="python"
              />
            </Box>
          </Tabs.Content>
        </Card.Body>
      </Card.Root>
    </Tabs.Root>
  );
}
