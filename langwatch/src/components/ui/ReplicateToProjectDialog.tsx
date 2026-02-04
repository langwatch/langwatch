import {
  Button,
  createListCollection,
  Field,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CopyTargetProject } from "~/hooks/useProjectsForCopy";
import { isHandledByGlobalLicenseHandler } from "~/utils/trpcError";
import { Dialog } from "./dialog";
import { Select } from "./select";
import { toaster } from "./toaster";

export type ReplicateToProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title: string;
  entityLabel: string;
  sourceName: string;
  sourceId?: string;
  /** Project we're copying from (current context) */
  sourceProjectId: string;
  projects: CopyTargetProject[];
  onCopy: (params: {
    projectId: string;
    sourceProjectId: string;
    [key: string]: unknown;
  }) => Promise<void>;
  isLoading: boolean;
  /** Optional content below project select (e.g. "Replicate associated dataset" checkbox) */
  extraContent?: ReactNode;
  /** Optional extra params merged into onCopy (e.g. { copyDatasets }) */
  getExtraCopyParams?: () => Record<string, unknown>;
  /** Optional error logger */
  logError?: (context: object, message: string) => void;
};

export function ReplicateToProjectDialog({
  open,
  onClose,
  onSuccess,
  title,
  entityLabel,
  sourceName,
  sourceId,
  sourceProjectId,
  projects,
  onCopy,
  isLoading,
  extraContent,
  getExtraCopyParams,
  logError,
}: ReplicateToProjectDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const projectCollection = createListCollection({
    items: projects,
  });

  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId) return;

    try {
      await onCopy({
        projectId,
        sourceProjectId,
        ...getExtraCopyParams?.(),
      });

      toaster.create({
        title: `${entityLabel} replicated`,
        description: `${entityLabel} "${sourceName}" replicated successfully.`,
        type: "success",
      });

      onSuccess?.();
      onClose();
    } catch (error) {
      // Skip toast if the global license handler already showed the upgrade modal
      if (isHandledByGlobalLicenseHandler(error)) return;

      logError?.(
        { error, ...(sourceId && { sourceId }), projectId },
        `Error replicating ${entityLabel.toLowerCase()}`,
      );
      toaster.create({
        title: `Error replicating ${entityLabel.toLowerCase()}`,
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  const currentProject = projectCollection.items.find(
    (p) => p.value === selectedProjectId[0],
  );
  const hasPermission = currentProject?.hasCreatePermission ?? false;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align={"start"}>
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={projectCollection}
                value={selectedProjectId}
                onValueChange={(e) => {
                  const selectedProject = projects.find(
                    (p) => p.value === e.value[0],
                  );
                  if (selectedProject?.hasCreatePermission) {
                    setSelectedProjectId(e.value);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content zIndex="popover" paddingY={2}>
                  {projectCollection.items.map((proj) => {
                    const perm = proj.hasCreatePermission;
                    return (
                      <Select.Item
                        key={proj.value}
                        item={proj}
                        opacity={perm ? 1 : 0.5}
                        cursor={perm ? "pointer" : "not-allowed"}
                      >
                        {proj.label}
                        {!perm && (
                          <Text
                            display="inline-block"
                            fontSize="sm"
                            color="fg.subtle"
                            ml={2}
                          >
                            (no permission)
                          </Text>
                        )}
                      </Select.Item>
                    );
                  })}
                </Select.Content>
              </Select.Root>
            </Field.Root>
            {extraContent}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => {
              void handleCopy();
            }}
            loading={isLoading}
            disabled={!selectedProjectId.length || !hasPermission}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
