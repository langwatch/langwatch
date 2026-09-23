import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { Switch } from "@langwatch/design-system/switch";

import { connectApi } from "../../behavior/connect-api.ts";
import { HOSTED_SERVICES, type HostedService } from "../../model/hosted-services.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import { SettingsBlock } from "../elements/settings-block.tsx";
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
    <SettingsBlock
      title="Hosted services"
      description="Choose which LangWatch-hosted services this install may call."
      testId="connect-services"
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
    </SettingsBlock>
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
    <HStack
      width="full"
      gap={4}
      align="start"
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      data-testid={`connect-service-${service.id}`}
    >
      <VStack align="start" gap={1} flex={1}>
        <HStack gap={2}>
          <Text fontWeight="medium">{service.name}</Text>
          <ServiceBadge isOn={isOn} isEntitled={isEntitled} />
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {service.description}
        </Text>
        <VStack align="start" gap={0.5} paddingTop={1}>
          {service.dataStatements.map((statement) => (
            <Text key={statement} fontSize="sm" color="fg.muted">
              {statement}
            </Text>
          ))}
        </VStack>
      </VStack>
      <Switch
        checked={isOn}
        disabled={!canManage || !isEntitled || isSaving}
        aria-label={service.name}
        inputProps={{ "data-testid": `connect-service-switch-${service.id}` }}
        onCheckedChange={(event) => onToggle(event.checked)}
      />
    </HStack>
  );
}

function ServiceBadge({ isOn, isEntitled }: { isOn: boolean; isEntitled: boolean }) {
  if (!isEntitled) {
    return (
      <Badge colorPalette="orange" size="sm" variant="surface">
        Not included in your license
      </Badge>
    );
  }
  return (
    <Badge colorPalette={isOn ? "green" : "gray"} size="sm" variant="surface">
      {isOn ? "On" : "Available, switched off"}
    </Badge>
  );
}
