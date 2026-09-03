/**
 * Replicating an online evaluation into another project.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/ui/ReplicateToProjectDialog.tsx` (plus the
 * `CopyMonitorDialog` that wrapped it), which the evaluator and workflow copy
 * dialogs also render, so the platform module stays.
 *
 * Works for every monitor: evaluator-backed ones bring their evaluator (and its
 * workflow) along through `monitors.copy`, legacy wizard ones carry their
 * inline settings — which is the platform docblock's claim, kept, because it is
 * the reason this action is offered on every row rather than some.
 *
 * A CLOSED TARGET IS LISTED AND GREYED rather than hidden, which is the platform
 * dialog's behaviour.
 */

import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

import { monitorApi } from "../../behavior/monitor-api";
import { useMonitorHost } from "../../model/monitor-host";

export function MonitorReplicateDialog({
  open,
  onClose,
  onSuccess,
  monitorId,
  monitorName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  monitorId: string;
  monitorName: string;
}) {
  const host = useMonitorHost();
  const { projectId } = host.scope();
  const [selected, setSelected] = useState<string[]>([]);
  const copyMonitor = monitorApi.monitors.copy.useMutation();

  const targets = host.copyTargets();
  const collection = createListCollection({
    items: targets.map((target) => ({ label: target.name, value: target.id })),
  });
  const chosen = targets.find((target) => target.id === selected[0]);

  const replicate = async () => {
    const targetProjectId = selected[0];
    if (!targetProjectId || !projectId) return;

    try {
      await copyMonitor.mutateAsync({
        monitorId,
        projectId: targetProjectId,
        sourceProjectId: projectId,
      });
      host.succeeded({
        title: "Online evaluator replicated",
        description: `Online evaluator "${monitorName}" replicated successfully.`,
      });
      onSuccess?.();
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't replicate the online evaluator" });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate online evaluator</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={collection}
                value={selected}
                onValueChange={(event) => {
                  const target = targets.find((candidate) => candidate.id === event.value[0]);
                  if (target?.canCreate) setSelected(event.value);
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content paddingY={2}>
                  {collection.items.map((item) => {
                    const canCreate =
                      targets.find((target) => target.id === item.value)?.canCreate ?? false;
                    return (
                      <Select.Item
                        key={item.value}
                        item={item}
                        opacity={canCreate ? 1 : 0.5}
                        cursor={canCreate ? "pointer" : "not-allowed"}
                      >
                        {item.label}
                        {!canCreate && (
                          <Text
                            display="inline-block"
                            fontSize="sm"
                            color="fg.subtle"
                            marginLeft={2}
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
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void replicate()}
            loading={copyMonitor.isPending}
            disabled={selected.length === 0 || !chosen?.canCreate}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
