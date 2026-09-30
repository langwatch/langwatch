import { HStack, Text, VStack } from "@chakra-ui/react";
import { SettingsCard, StatusChip } from "@langwatch/design-system/settings-card";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { Cloud } from "lucide-react";

import { connectApi } from "../../behavior/connect-api.ts";
import { HOSTED_SERVICES, type HostedService } from "../../model/hosted-services.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import type { ConnectEnabledStatus } from "./connect-status.ts";

/** Every service starts off, and what it sends is on the page before the switch is touched. */
export function ConnectServicesSection({
  organizationId,
  status,
  onChanged,
}: {
  organizationId: string;
  status: ConnectEnabledStatus;
  onChanged: () => void;
}) {
  const host = useLicensingHost();
  const setService = connectApi.connect.setService.useMutation({
    onSuccess: () => onChanged(),
    onError: (error: unknown) =>
      host.failed({ error, fallbackTitle: "Couldn't change this service" }),
  });
  const entitled = status.entitledServices;

  return (
    <SettingsSection
      icon={<Cloud size={18} />}
      title="Hosted services"
      hint="Choose which LangWatch-hosted services this install may call."
      data-testid="connect-services"
    >
      <VStack width="full" align="stretch" gap={3}>
        {HOSTED_SERVICES.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            isOn={status.enabledServices.includes(service.id)}
            isEntitled={entitled === null || entitled.includes(service.id)}
            canManage={host.canManageOrganization()}
            isSaving={setService.isPending}
            onToggle={(enabled) =>
              setService.mutate({ organizationId, service: service.id, enabled })
            }
          />
        ))}
      </VStack>
    </SettingsSection>
  );
}

function ServiceRow({
  service,
  isOn,
  isEntitled,
  canManage,
  isSaving,
  onToggle,
}: {
  service: HostedService;
  isOn: boolean;
  isEntitled: boolean;
  canManage: boolean;
  isSaving: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <SettingsCard
      title={service.name}
      hint={service.description}
      badge={
        <HStack gap={3}>
          <ServiceBadge isOn={isOn} isEntitled={isEntitled} />
          <Switch
            checked={isOn}
            disabled={!canManage || !isEntitled || isSaving}
            aria-label={service.name}
            inputProps={{ "data-testid": `connect-service-switch-${service.id}` }}
            onCheckedChange={(event) => onToggle(event.checked)}
          />
        </HStack>
      }
      data-testid={`connect-service-${service.id}`}
    >
      <VStack align="start" gap={0.5}>
        {service.dataStatements.map((statement) => (
          <Text key={statement} fontSize="sm" color="fg.muted">
            {statement}
          </Text>
        ))}
      </VStack>
    </SettingsCard>
  );
}

function ServiceBadge({ isOn, isEntitled }: { isOn: boolean; isEntitled: boolean }) {
  if (!isEntitled) return <StatusChip label="Not included in your license" tone="warning" />;
  return (
    <StatusChip label={isOn ? "On" : "Available, switched off"} tone={isOn ? "good" : "neutral"} />
  );
}
