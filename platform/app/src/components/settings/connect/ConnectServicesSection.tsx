import { Badge, HStack, Text, VStack } from "@chakra-ui/react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { Switch } from "~/components/ui/switch";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

import {
  type ConnectEnabledView,
  HOSTED_SERVICES,
  type HostedService,
} from "./connectStatus";

interface ConnectServicesSectionProps {
  organizationId: string;
  status: ConnectEnabledView;
  canManage: boolean;
  onChanged: () => void;
}

/**
 * The hosted services this install may call, each with what it sends.
 *
 * Every service starts off, and the statement of what leaves the install is on
 * the page before the switch is touched rather than behind it.
 */
export function ConnectServicesSection({
  organizationId,
  status,
  canManage,
  onChanged,
}: ConnectServicesSectionProps) {
  const setService = api.connect.setService.useMutation({
    onSuccess: () => onChanged(),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Couldn't change this service" }),
  });

  const enabled = status.enabledServices;
  const entitled = status.entitledServices;

  return (
    <SettingsSection
      title="Hosted services"
      description="Choose which LangWatch-hosted services this install may call."
      testId="connect-services"
    >
      <VStack width="full" align="stretch" gap={3}>
        {HOSTED_SERVICES.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            isOn={enabled.includes(service.id)}
            isEntitled={entitled === null || entitled.includes(service.id)}
            canManage={canManage}
            isSaving={setService.isPending}
            onToggle={(next) =>
              setService.mutate({
                organizationId,
                service: service.id,
                enabled: next,
              })
            }
          />
        ))}
      </VStack>
    </SettingsSection>
  );
}

interface ServiceRowProps {
  service: HostedService;
  isOn: boolean;
  isEntitled: boolean;
  canManage: boolean;
  isSaving: boolean;
  onToggle: (next: boolean) => void;
}

function ServiceRow({
  service,
  isOn,
  isEntitled,
  canManage,
  isSaving,
  onToggle,
}: ServiceRowProps) {
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

function ServiceBadge({
  isOn,
  isEntitled,
}: {
  isOn: boolean;
  isEntitled: boolean;
}) {
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
