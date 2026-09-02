/**
 * Replicating one prompt into another project.
 *
 * A family-local copy of
 * `platform/app/src/components/ui/ReplicateToProjectDialog.tsx` (three other
 * callers, un-repointable), narrowed to the one entity it copies here — the
 * agents family's `agent-replicate-dialog`, second use.
 *
 * WHAT DID NOT TRAVEL is the toast and the log line. Both were the
 * application's to make — a feature-web package may reach neither a toaster
 * singleton nor a logger — so the outcome is handed back to the caller, which
 * is the screen, and the screen tells the host. The refusal to select a project
 * the reader cannot create in is unchanged: the option renders greyed with
 * "(no permission)" and selecting it leaves the button disabled.
 */

import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

/** One project the picker offers, in the shape Chakra's select collection wants. */
export type PromptReplicateTarget = {
  value: string;
  label: string;
  hasCreatePermission: boolean;
};

export type PromptReplicateDialogProps = {
  open: boolean;
  promptName: string;
  projects: readonly PromptReplicateTarget[];
  isLoading: boolean;
  onClose: () => void;
  onCopy: (targetProjectId: string) => Promise<void>;
};

export function PromptReplicateDialog({
  open,
  promptName,
  projects,
  isLoading,
  onClose,
  onCopy,
}: PromptReplicateDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const projectCollection = createListCollection({ items: [...projects] });

  /**
   * The dialog does not close itself. Whether a replication succeeded is the
   * caller's to know, and the platform version closing inside its own `try`
   * meant a refused copy left the reader looking at the page it came from with
   * only a toast to say why.
   */
  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId) return;
    await onCopy(projectId);
  };

  const currentProject = projectCollection.items.find(
    (project) => project.value === selectedProjectId[0],
  );
  const hasPermission = currentProject?.hasCreatePermission ?? false;

  return (
    <Dialog.Root open={open} onOpenChange={(event) => !event.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Prompt</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text fontSize="sm" color="fg.muted">
              {`"${promptName}" will be copied into the project you choose.`}
            </Text>
            <Field.Root>
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
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void handleCopy()}
            loading={isLoading}
            disabled={selectedProjectId.length === 0 || !hasPermission}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
