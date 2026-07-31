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

const FAMILY_LABELS: Record<string, string> = {
  gateway: "Gateway",
};

function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family;
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
  onSave: (input: {
    url: string;
    enabledEvents: string[];
    maxBatchSize: number;
    maxBatchDelayMs: number;
    maxInFlight: number;
  }) => void;
}) {
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

  const families = useMemo(() => {
    const grouped = new Map<string, EventType[]>();
    for (const t of eventTypes ?? []) {
      const list = grouped.get(t.family) ?? [];
      list.push(t);
      grouped.set(t.family, list);
    }
    return [...grouped.entries()];
  }, [eventTypes]);

  const toggle = (value: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const toggleFamily = (family: string, on: boolean) => {
    const wildcard = `${family}.*`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(wildcard);
        // The wildcard implies every type; drop redundant exact entries.
        for (const value of [...next]) {
          if (value.startsWith(`${family}.`) && value !== wildcard) {
            next.delete(value);
          }
        }
      } else {
        next.delete(wildcard);
      }
      return next;
    });
  };

  // Mirrors the server bounds; NaN from a cleared field fails these too.
  const controlsValid =
    Number.isInteger(maxBatchSize) &&
    maxBatchSize >= 1 &&
    maxBatchSize <= 100 &&
    Number.isInteger(maxBatchDelayMs) &&
    maxBatchDelayMs >= 0 &&
    maxBatchDelayMs <= 60000 &&
    Number.isInteger(maxInFlight) &&
    maxInFlight >= 1 &&
    maxInFlight <= 8;

  const canSave =
    url.trim().length > 0 && selected.size > 0 && controlsValid && !isSaving;

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
          <VStack gap={6} align="start" width="full">
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
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/langwatch"
                data-testid="webhook-url-input"
              />
            </VStack>

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
              {families.map(([family, types]) => {
                const wildcard = `${family}.*`;
                const wildcardOn = selected.has(wildcard);
                return (
                  <VStack
                    key={family}
                    align="start"
                    gap={2}
                    width="full"
                    data-testid={`webhook-family-${family}`}
                  >
                    <Checkbox
                      checked={wildcardOn}
                      onCheckedChange={({ checked }) =>
                        toggleFamily(family, checked === true)
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
                            toggle(t.type, checked === true)
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
              })}
            </VStack>

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
                <VStack gap={1} align="start">
                  <Text fontSize="xs" color="fg.muted">
                    Batch size
                  </Text>
                  <Input
                    type="number"
                    size="sm"
                    width="90px"
                    min={1}
                    max={100}
                    value={maxBatchSize}
                    onChange={(e) => setMaxBatchSize(Number(e.target.value))}
                    data-testid="webhook-max-batch-size"
                  />
                </VStack>
                <VStack gap={1} align="start">
                  <Text fontSize="xs" color="fg.muted">
                    Batch delay (ms)
                  </Text>
                  <Input
                    type="number"
                    size="sm"
                    width="110px"
                    min={0}
                    max={60000}
                    value={maxBatchDelayMs}
                    onChange={(e) => setMaxBatchDelayMs(Number(e.target.value))}
                    data-testid="webhook-max-batch-delay"
                  />
                </VStack>
                <VStack gap={1} align="start">
                  <Text fontSize="xs" color="fg.muted">
                    In-flight
                  </Text>
                  <Input
                    type="number"
                    size="sm"
                    width="80px"
                    min={1}
                    max={8}
                    value={maxInFlight}
                    onChange={(e) => setMaxInFlight(Number(e.target.value))}
                    data-testid="webhook-max-in-flight"
                  />
                </VStack>
              </HStack>
            </VStack>
          </VStack>
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
              onClick={() =>
                onSave({
                  url: url.trim(),
                  enabledEvents: [...selected],
                  maxBatchSize,
                  maxBatchDelayMs,
                  maxInFlight,
                })
              }
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
