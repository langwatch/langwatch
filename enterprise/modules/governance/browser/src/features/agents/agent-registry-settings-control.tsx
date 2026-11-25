import { Popover } from "@langwatch/design-system/popover";
import { Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import {
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX,
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN,
} from "@langwatch/enterprise-governance-contract";
import { Clock } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../behavior/governance-feedback.ts";
import { parseDormancyDays } from "./agent-registry-settings";

/**
 * The organisation's dormancy window: how many days without traces make a listed agent dormant.
 * Only rendered for readers who may save it; the caller gates on ingestionSources:manage.
 * @see enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

function useDormancyWindow({ organizationId }: { organizationId: string }) {
  const utils = api.useUtils();
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const settings = api.governanceRegistry.settings.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const save = api.governanceRegistry.saveSettings.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Dormancy window saved", type: "success" });
      await Promise.all([
        utils.governanceRegistry.settings.invalidate({ organizationId }),
        utils.governanceAgents.list.invalidate({ organizationId }),
      ]);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save the dormancy window" }),
  });
  return {
    // Only a successful read decides the window; the server answers its default when none is saved.
    days: settings.data?.dormant_after_days ?? null,
    isLoading: settings.isPending,
    isReadFailed: settings.isError,
    retry: () => void settings.refetch(),
    save,
  };
}

export function AgentRegistrySettingsControl({ organizationId }: { organizationId: string }) {
  const { days, isLoading, isReadFailed, retry, save } = useDormancyWindow({ organizationId });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const parsed = parseDormancyDays(draft);

  const openWith = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) setDraft(days === null ? "" : String(days));
  };

  const submit = () => {
    if (parsed === null || save.isPending) return;
    save.mutate(
      { organizationId, dormant_after_days: parsed },
      { onSuccess: () => setOpen(false) },
    );
  };

  if (isReadFailed) {
    return (
      <Button size="sm" variant="ghost" onClick={retry} data-testid="dormancy-window-retry">
        <Clock size={14} />
        Couldn't load the dormancy window. Retry
      </Button>
    );
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open: isOpen }) => openWith(isOpen)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={isLoading || days === null}
          data-testid="dormancy-window-button"
        >
          <Clock size={14} />
          {days === null
            ? "Dormancy window"
            : `Dormant after ${days} ${days === 1 ? "day" : "days"}`}
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Body>
          <VStack align="stretch" gap={2}>
            <Text textStyle="sm" fontWeight="medium">
              Mark agents dormant after
            </Text>
            <HStack gap={2}>
              <Input
                size="sm"
                type="number"
                inputMode="numeric"
                min={AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN}
                max={AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX}
                aria-label="Days without traces"
                aria-invalid={parsed === null || undefined}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                width="24"
              />
              <Text textStyle="sm" color="fg.muted">
                days without traces
              </Text>
            </HStack>
            {parsed === null && (
              <Text fontSize="xs" color="red.fg" data-testid="dormancy-window-error">
                {`Enter a whole number from ${AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN} to ${AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX}.`}
              </Text>
            )}
            <HStack justify="end">
              <Button
                size="xs"
                variant="outline"
                onClick={submit}
                loading={save.isPending}
                disabled={parsed === null || save.isPending}
              >
                Save
              </Button>
            </HStack>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
