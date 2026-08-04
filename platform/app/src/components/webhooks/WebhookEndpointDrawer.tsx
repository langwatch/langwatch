import {
  Badge,
  Button,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { WebhookEventType } from "@ee/webhooks/eventRegistry";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import type { RouterOutputs } from "~/utils/api";

type EventType = WebhookEventType;
type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];

/** What the drawer hands back on save, for create and edit alike. */
type EndpointInput = {
  url: string;
  enabledEvents: string[];
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
};

const FAMILY_LABELS: Record<string, string> = {
  gateway: "Gateway",
};

function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family;
}

/** Mirrors the server bounds; NaN from a cleared field fails these too. */
function controlsWithinBounds(
  maxBatchSize: number,
  maxBatchDelayMs: number,
  maxInFlight: number,
) {
  return (
    Number.isInteger(maxBatchSize) &&
    maxBatchSize >= 1 &&
    maxBatchSize <= 100 &&
    Number.isInteger(maxBatchDelayMs) &&
    maxBatchDelayMs >= 0 &&
    maxBatchDelayMs <= 60000 &&
    Number.isInteger(maxInFlight) &&
    maxInFlight >= 1 &&
    maxInFlight <= 8
  );
}

/**
 * The selection after toggling a family header, which is the `<family>.*`
 * wildcard.
 */
function withFamilyToggled(
  selected: Set<string>,
  family: string,
  on: boolean,
): Set<string> {
  const wildcard = `${family}.*`;
  const next = new Set(selected);
  if (!on) {
    next.delete(wildcard);
    return next;
  }
  next.add(wildcard);
  // The wildcard implies every type; drop redundant exact entries.
  for (const value of [...next]) {
    if (value.startsWith(`${family}.`) && value !== wildcard) {
      next.delete(value);
    }
  }
  return next;
}

/**
 * The drawer's form: the fields, reset to the endpoint being edited every
 * time the drawer opens, plus the save payload they add up to.
 */
function useEndpointForm(isOpen: boolean, endpoint: EndpointView | null) {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxBatchSize, setMaxBatchSize] = useState(100);
  const [maxBatchDelayMs, setMaxBatchDelayMs] = useState(250);
  const [maxInFlight, setMaxInFlight] = useState(4);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(endpoint?.url ?? "");
    setSelected(new Set(endpoint?.enabledEvents ?? []));
    setMaxBatchSize(endpoint?.maxBatchSize ?? 100);
    setMaxBatchDelayMs(endpoint?.maxBatchDelayMs ?? 250);
    setMaxInFlight(endpoint?.maxInFlight ?? 4);
  }, [isOpen, endpoint]);

  const toggleType = (value: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const toggleFamily = (family: string, on: boolean) => {
    setSelected((prev) => withFamilyToggled(prev, family, on));
  };

  return {
    url,
    setUrl,
    selected,
    maxBatchSize,
    setMaxBatchSize,
    maxBatchDelayMs,
    setMaxBatchDelayMs,
    maxInFlight,
    setMaxInFlight,
    toggleType,
    toggleFamily,
    isValid:
      url.trim().length > 0 &&
      selected.size > 0 &&
      controlsWithinBounds(maxBatchSize, maxBatchDelayMs, maxInFlight),
    toInput: (): EndpointInput => ({
      url: url.trim(),
      enabledEvents: [...selected],
      maxBatchSize,
      maxBatchDelayMs,
      maxInFlight,
    }),
  };
}

type EndpointForm = ReturnType<typeof useEndpointForm>;

function EndpointUrlField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <VStack gap={2} align="start" width="full">
      <HStack gap={1}>
        <Text fontWeight="600" fontSize="sm">
          Endpoint URL
        </Text>
        <FieldInfoTooltip
          description="HTTPS only. Batches of up to 100 events arrive as POST requests signed with the endpoint's secret."
          testId="webhook-url-info"
        />
      </HStack>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://example.com/webhooks/langwatch"
        data-testid="webhook-url-input"
      />
    </VStack>
  );
}

/**
 * One family block: the wildcard header checkbox and the family's types.
 * While the header is on the types are implied, so they render checked and
 * locked.
 */
function EventFamilySection({
  family,
  types,
  selected,
  onToggleType,
  onToggleFamily,
}: {
  family: string;
  types: readonly EventType[];
  selected: Set<string>;
  onToggleType: (type: string, on: boolean) => void;
  onToggleFamily: (family: string, on: boolean) => void;
}) {
  const wildcardOn = selected.has(`${family}.*`);

  return (
    <VStack
      align="start"
      gap={2}
      width="full"
      data-testid={`webhook-family-${family}`}
    >
      <Checkbox
        checked={wildcardOn}
        onCheckedChange={({ checked }) =>
          onToggleFamily(family, checked === true)
        }
        data-testid={`webhook-family-toggle-${family}`}
      >
        <Text fontWeight="600" fontSize="sm">
          All {familyLabel(family)} events
        </Text>
      </Checkbox>
      <VStack align="start" gap={1} paddingLeft={6}>
        {types.map((t) => (
          <Checkbox
            key={t.type}
            checked={wildcardOn || selected.has(t.type)}
            disabled={wildcardOn}
            onCheckedChange={({ checked }) =>
              onToggleType(t.type, checked === true)
            }
            data-testid={`webhook-event-${t.type}`}
          >
            <HStack gap={2}>
              <Text fontSize="sm">{t.type}</Text>
              {!t.isEmitting && (
                <Badge size="sm" colorPalette="gray">
                  not emitting yet
                </Badge>
              )}
            </HStack>
          </Checkbox>
        ))}
      </VStack>
    </VStack>
  );
}

/** The subscription: one checkbox per registry type, grouped by family. */
function EventsSection({
  eventTypes,
  selected,
  onToggleType,
  onToggleFamily,
}: {
  eventTypes: readonly EventType[] | undefined;
  selected: Set<string>;
  onToggleType: (type: string, on: boolean) => void;
  onToggleFamily: (family: string, on: boolean) => void;
}) {
  const families = useMemo(() => {
    const grouped = new Map<string, EventType[]>();
    for (const t of eventTypes ?? []) {
      const list = grouped.get(t.family) ?? [];
      list.push(t);
      grouped.set(t.family, list);
    }
    return [...grouped.entries()];
  }, [eventTypes]);

  return (
    <VStack gap={3} align="start" width="full">
      <HStack gap={1}>
        <Text fontWeight="600" fontSize="sm">
          Events
        </Text>
        <FieldInfoTooltip
          description="The endpoint receives only the selected event types. The family checkbox subscribes to every type in that family, including ones added later."
          testId="webhook-events-info"
        />
      </HStack>
      {!eventTypes && <Spinner size="sm" />}
      {families.map(([family, types]) => (
        <EventFamilySection
          key={family}
          family={family}
          types={types}
          selected={selected}
          onToggleType={onToggleType}
          onToggleFamily={onToggleFamily}
        />
      ))}
    </VStack>
  );
}

/** One bounded number field of the delivery controls. */
function DeliveryNumberField({
  label,
  width,
  min,
  max,
  value,
  onChange,
  testId,
}: {
  label: string;
  width: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <VStack gap={1} align="start">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Input
        type="number"
        size="sm"
        width={width}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={testId}
      />
    </VStack>
  );
}

/** How hard this endpoint is driven: batch shape and delivery concurrency. */
function DeliveryControlsSection({ form }: { form: EndpointForm }) {
  return (
    <VStack gap={3} align="start" width="full">
      <HStack gap={1}>
        <Text fontWeight="600" fontSize="sm">
          Delivery
        </Text>
        <FieldInfoTooltip
          description="Batch size caps how many events ship per POST (up to 100). Batch delay is how long a partial batch waits for more events before shipping. In-flight caps concurrent POSTs to your receiver; when it is behind, batches grow toward the cap to drain faster."
          testId="webhook-delivery-info"
        />
      </HStack>
      <HStack gap={4} width="full">
        <DeliveryNumberField
          label="Batch size"
          width="90px"
          min={1}
          max={100}
          value={form.maxBatchSize}
          onChange={form.setMaxBatchSize}
          testId="webhook-max-batch-size"
        />
        <DeliveryNumberField
          label="Batch delay (ms)"
          width="110px"
          min={0}
          max={60000}
          value={form.maxBatchDelayMs}
          onChange={form.setMaxBatchDelayMs}
          testId="webhook-max-batch-delay"
        />
        <DeliveryNumberField
          label="In-flight"
          width="80px"
          min={1}
          max={8}
          value={form.maxInFlight}
          onChange={form.setMaxInFlight}
          testId="webhook-max-in-flight"
        />
      </HStack>
    </VStack>
  );
}

function EndpointFormFields({
  form,
  eventTypes,
}: {
  form: EndpointForm;
  eventTypes: readonly EventType[] | undefined;
}) {
  return (
    <VStack gap={6} align="start" width="full">
      <EndpointUrlField value={form.url} onChange={form.setUrl} />
      <EventsSection
        eventTypes={eventTypes}
        selected={form.selected}
        onToggleType={form.toggleType}
        onToggleFamily={form.toggleFamily}
      />
      <DeliveryControlsSection form={form} />
    </VStack>
  );
}

/**
 * Create/edit drawer for one webhook endpoint: the URL plus the event
 * subscription, rendered as one checkbox per registry type grouped by
 * family. The family header checkbox is the `<family>.*` wildcard: while
 * it is on, the individual types are implied and their checkboxes locked.
 */
export function WebhookEndpointDrawer({
  isOpen,
  endpoint,
  eventTypes,
  isSaving,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  /** null creates; an existing view edits. */
  endpoint: EndpointView | null;
  eventTypes: readonly EventType[] | undefined;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: EndpointInput) => void;
}) {
  const form = useEndpointForm(isOpen, endpoint);
  const canSave = form.isValid && !isSaving;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">
            {endpoint ? "Edit webhook endpoint" : "New webhook endpoint"}
          </Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <EndpointFormFields form={form} eventTypes={eventTypes} />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => onSave(form.toInput())}
              data-testid="webhook-save"
            >
              {endpoint ? "Save changes" : "Create endpoint"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
