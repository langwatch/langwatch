/**
 * Replicates an online evaluation into another project; works for evaluator-backed
 * and legacy wizard monitors.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { createListCollection, Field, Text, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { useRef, useState } from "react";

import { monitorApi } from "../../behavior/monitor-api.ts";
import { useMonitorHost } from "../../model/monitor-host.ts";

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
  const [attempted, setAttempted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyMonitor = monitorApi.monitors.copy.useMutation();

  const targets = host.copyTargets();
  const collection = createListCollection({
    items: targets.map((target) => ({ label: target.name, value: target.id })),
  });
  const chosen = targets.find((target) => target.id === selected[0]);

  const missingTarget = attempted && !chosen?.canCreate;

  const replicate = async () => {
    if (copyMonitor.isPending) return;
    const targetProjectId = selected[0];
    if (!targetProjectId || !chosen?.canCreate) {
      setAttempted(true);
      triggerRef.current?.focus();
      return;
    }
    if (!projectId) return;

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
    <Dialog
      open={open}
      onClose={onClose}
      title="Replicate online evaluator"
      busy={copyMonitor.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        void replicate();
      }}
      primaryAction={{
        label: "Replicate",
        type: "submit",
        loading: copyMonitor.isPending,
      }}
    >
      <VStack gap={4} align="start">
        <Field.Root invalid={missingTarget}>
          <Field.Label>Target Project</Field.Label>
          <Select.Root
            collection={collection}
            value={selected}
            onValueChange={(event) => {
              const target = targets.find((candidate) => candidate.id === event.value[0]);
              if (target?.canCreate) setSelected(event.value);
            }}
          >
            <Select.Trigger ref={triggerRef}>
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
                      <Text display="inline-block" fontSize="sm" color="fg.subtle" marginLeft={2}>
                        (no permission)
                      </Text>
                    )}
                  </Select.Item>
                );
              })}
            </Select.Content>
          </Select.Root>
          <Field.ErrorText>Choose a project to replicate into.</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
