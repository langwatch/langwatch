import { Dialog } from "@langwatch/design-system/dialog";
import { createListCollection, Field, Text, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

import type { AgentCopyTarget } from "../../model/agent-management-host.ts";

/** Projects without create permission remain visible but cannot be selected. */

export type AgentReplicateDialogProps = {
  open: boolean;
  agentName: string;
  projects: readonly AgentCopyTarget[];
  isLoading: boolean;
  onClose: () => void;
  onCopy: (targetProjectId: string) => Promise<void>;
};

export function AgentReplicateDialog({
  open,
  agentName,
  projects,
  isLoading,
  onClose,
  onCopy,
}: AgentReplicateDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);

  const projectCollection = createListCollection({ items: [...projects] });

  /** The caller owns closing so refused copies remain visible in the dialog. */
  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId) return;

    await onCopy(projectId);
  };

  const currentProject = projectCollection.items.find(
    (project) => project.value === selectedProjectId[0],
  );
  const hasPermission = currentProject?.hasCreatePermission ?? false;

  const copy = () => {
    if (isLoading) return;
    if (selectedProjectId.length === 0 || !hasPermission) return setAttempted(true);
    void handleCopy();
  };
  const missing = attempted && (selectedProjectId.length === 0 || !hasPermission);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Replicate Agent"
      busy={isLoading}
      primaryAction={{ label: "Replicate", onClick: copy, loading: isLoading }}
    >
      <VStack gap={4} align="start">
        <Text fontSize="sm" color="fg.muted">
          {`"${agentName}" will be copied into the project you choose.`}
        </Text>
        <Field.Root invalid={missing}>
          <Field.Label>Target Project</Field.Label>
          <Select.Root
            collection={projectCollection}
            value={selectedProjectId}
            onValueChange={(event) => {
              const selected = projects.find((project) => project.value === event.value[0]);
              if (selected?.hasCreatePermission) setSelectedProjectId(event.value);
            }}
          >
            <Select.Trigger>
              <Select.ValueText placeholder="Select project" />
            </Select.Trigger>
            <Select.Content paddingY={2}>
              {projectCollection.items.map((project) => (
                <Select.Item
                  key={project.value}
                  item={project}
                  opacity={project.hasCreatePermission ? 1 : 0.5}
                  cursor={project.hasCreatePermission ? "pointer" : "not-allowed"}
                >
                  {project.label}
                  {!project.hasCreatePermission && (
                    <Text display="inline-block" fontSize="sm" color="fg.subtle" marginLeft={2}>
                      (no permission)
                    </Text>
                  )}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Field.ErrorText>Choose a project you can create agents in.</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
