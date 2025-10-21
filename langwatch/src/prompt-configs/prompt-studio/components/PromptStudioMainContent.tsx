import { HStack } from "@chakra-ui/react";
import { PromptStudioTabbedWorkSpace } from "./prompt-browser/PromptStudioTabbedWorkSpace";
import { usePromptStudioStore } from "../prompt-studio-store/store";
import { useMemo } from "react";

export function PromptStudioMainContent() {
  const rels = usePromptStudioStore((s) => s.promptsInWorkspaces);

  const workspaceIndices = useMemo(() => {
    return Array.from(new Set(rels.map((r) => r.workspaceIndex))).sort(
      (a, b) => a - b,
    );
  }, [rels]);

  return (
    <HStack width="full" height="full" gap={0} overflowX="scroll">
      {workspaceIndices.map((workspaceIndex) => (
        <PromptStudioTabbedWorkSpace
          key={workspaceIndex}
          workspaceIndex={workspaceIndex}
        />
      ))}
    </HStack>
  );
}
