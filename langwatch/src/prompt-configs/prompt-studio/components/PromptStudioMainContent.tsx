import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./prompt-browser/PromptStudioTabbedWorkSpace";
import { usePromptStudioStore } from "../prompt-studio-store/store";

export function PromptStudioMainContent() {
  const { workspaces } = usePromptStudioStore();
  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      {workspaces.map((workspace) => (
        <PromptStudioTabbedWorkSpace
          key={workspace.id}
          workspaceId={workspace.id}
        />
      ))}
    </HStack>
  );
}
