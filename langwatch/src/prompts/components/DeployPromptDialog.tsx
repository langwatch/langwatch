import {
  Box,
  Button,
  Code,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Info } from "react-feather";
import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/tooltip";
import { toaster } from "~/components/ui/toaster";
import { VALID_LABELS } from "~/server/prompt-config/repositories/llm-config-label.repository";
import { api } from "~/utils/api";

interface DeployPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  handle: string;
  projectId: string;
}

/**
 * DeployPromptDialog
 *
 * Dialog for assigning prompt versions to environment labels (production, staging).
 * The "latest" label is auto-managed and always points to the highest version number.
 */
export function DeployPromptDialog({
  isOpen,
  onClose,
  configId,
  handle,
  projectId,
}: DeployPromptDialogProps) {
  const versionsQuery = api.prompts.getAllVersionsForPrompt.useQuery(
    { idOrHandle: configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const labelsQuery = api.prompts.getLabelsForConfig.useQuery(
    { configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const assignLabel = api.prompts.assignLabel.useMutation();
  const utils = api.useContext();

  const versions = versionsQuery.data ?? [];

  const latestVersion = versions.reduce<typeof versions[number] | null>(
    (max, v) => (!max || v.version > max.version ? v : max),
    null,
  );

  type LabelSelections = Record<string, string>;
  const [labelSelections, setLabelSelections] = useState<LabelSelections>(
    () => Object.fromEntries(VALID_LABELS.map((l) => [l, ""])),
  );

  const setLabelVersionId = useCallback((label: string, versionId: string) => {
    setLabelSelections((prev) => ({ ...prev, [label]: versionId }));
  }, []);

  // Initialize selections from current label assignments
  useEffect(() => {
    const data = labelsQuery.data;
    if (!data?.length) {
      setLabelSelections(Object.fromEntries(VALID_LABELS.map((l) => [l, ""])));
      return;
    }

    const next: LabelSelections = {};
    for (const label of VALID_LABELS) {
      const found = data.find((l) => l.label === label);
      next[label] = found?.versionId ?? "";
    }
    setLabelSelections(next);
  }, [labelsQuery.data]);

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const data = labelsQuery.data ?? [];

    const mutations: Promise<unknown>[] = [];

    for (const label of VALID_LABELS) {
      const selectedVersionId = labelSelections[label] ?? "";
      const currentLabel = data.find((l) => l.label === label);
      if (selectedVersionId && selectedVersionId !== (currentLabel?.versionId ?? "")) {
        mutations.push(
          assignLabel.mutateAsync({
            projectId,
            configId,
            versionId: selectedVersionId,
            label,
          }),
        );
      }
    }

    if (mutations.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(mutations);
      await utils.prompts.getLabelsForConfig.invalidate({ configId, projectId });
      toaster.create({
        title: "Labels saved",
        type: "success",
        duration: 2000,
        meta: { closable: true },
      });
      onClose();
    } catch {
      toaster.create({
        title: "Failed to save labels",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    labelsQuery.data,
    labelSelections,
    assignLabel,
    projectId,
    configId,
    onClose,
    utils,
  ]);

  const versionOptions = [...versions].sort((a, b) => b.version - a.version);

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="md"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy prompt</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              Assign prompt versions to environment labels. Default (no label)
              returns the latest version.
            </Text>

            <HStack gap={2}>
              <Code fontSize="sm" paddingX={2} paddingY={1}>
                {handle}
              </Code>
              <CopyButton value={handle} label="Prompt slug" />
            </HStack>

            {/* Label rows */}
            <VStack align="stretch" gap={3}>
              {/* latest row — auto-managed, not editable */}
              <HStack justify="space-between">
                <HStack gap={2}>
                  <Text fontWeight="medium" fontSize="sm">
                    latest
                  </Text>
                  <Tooltip content="Automatically points to the highest version number. This label is managed by the system.">
                    <Box color="fg.muted" cursor="help">
                      <Info size={14} />
                    </Box>
                  </Tooltip>
                </HStack>
                <Text fontSize="sm" color="fg.muted" data-testid="latest-version">
                  {latestVersion ? `v${latestVersion.version}` : "--"}
                </Text>
              </HStack>

              {/* Environment label rows */}
              {VALID_LABELS.map((label) => (
                <HStack key={label} justify="space-between">
                  <Text fontWeight="medium" fontSize="sm">
                    {label}
                  </Text>
                  <NativeSelect.Root size="sm" width="auto" minWidth="200px">
                    <NativeSelect.Field
                      aria-label={`${label.charAt(0).toUpperCase()}${label.slice(1)} version`}
                      value={labelSelections[label] ?? ""}
                      onChange={(e) => setLabelVersionId(label, e.target.value)}
                    >
                      <option value="">-- Select version --</option>
                      {versionOptions.map((v) => (
                        <option key={v.versionId} value={v.versionId}>
                          v{v.version} — {v.commitMessage ?? "No message"}
                        </option>
                      ))}
                    </NativeSelect.Field>
                  </NativeSelect.Root>
                </HStack>
              ))}
            </VStack>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => void handleSave()}
              loading={isSaving}
            >
              Save changes
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
