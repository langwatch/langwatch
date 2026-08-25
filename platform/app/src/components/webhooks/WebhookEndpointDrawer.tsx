import {
  Badge,
  Button,
  Code,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { WebhookEventType } from "@langwatch/enterprise-webhook-contract";
import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { toaster } from "~/components/ui/toaster";
import type { RouterOutputs } from "~/utils/api";
import {
  WEBHOOK_DESTINATION_LABELS,
  type WebhookDestinationKind,
} from "~/utils/webhookDestinations";

type EventType = WebhookEventType;
type EndpointView = RouterOutputs["webhookEndpoints"]["list"][number];

/** What the drawer hands back on save, for create and edit alike. */
type EndpointInput = {
  destinationKind: WebhookDestinationKind;
  url?: string;
  sqs?: {
    queueUrl: string;
    roleArn?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
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
function useDestinationFields(isOpen: boolean, endpoint: EndpointView | null) {
  const [destinationKind, setDestinationKind] = useState<WebhookDestinationKind>("http");
  const [url, setUrl] = useState("");
  const [queueUrl, setQueueUrl] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setDestinationKind(endpoint?.destinationKind ?? "http");
    setUrl(endpoint?.url ?? "");
    setQueueUrl(endpoint?.sqs?.queueUrl ?? "");
    setRoleArn(endpoint?.sqs?.roleArn ?? "");
    setAccessKeyId(endpoint?.sqs?.accessKeyId ?? "");
    // Never prefilled: the stored secret is not readable, and an empty box
    // means "keep what is stored" rather than "clear it".
    setSecretAccessKey("");
  }, [isOpen, endpoint]);

  return {
    destinationKind,
    setDestinationKind,
    url,
    setUrl,
    queueUrl,
    setQueueUrl,
    roleArn,
    setRoleArn,
    // Read-only: the server mints it when a role is first named, and the
    // customer needs to read it back to write the role's trust policy.
    externalId: endpoint?.sqs?.externalId ?? null,
    accessKeyId,
    setAccessKeyId,
    secretAccessKey,
    setSecretAccessKey,
    isAddressFilled:
      destinationKind === "sqs" ? queueUrl.trim().length > 0 : url.trim().length > 0,
    toDestinationInput: (): DestinationInput =>
      destinationKind === "sqs"
        ? {
            destinationKind,
            sqs: sqsInput({
              queueUrl,
              roleArn,
              accessKeyId,
              secretAccessKey,
            }),
          }
        : { destinationKind, url: url.trim() },
  };
}

type DestinationInput = Pick<EndpointInput, "destinationKind" | "url" | "sqs">;

/** The queue fields as the wire takes them: trimmed, and empty ones left
 *  out entirely rather than sent as blanks. An absent secret is what keeps
 *  the stored one rather than clearing it. */
function sqsInput({
  queueUrl,
  roleArn,
  accessKeyId,
  secretAccessKey,
}: {
  queueUrl: string;
  roleArn: string;
  accessKeyId: string;
  secretAccessKey: string;
}): NonNullable<EndpointInput["sqs"]> {
  return {
    queueUrl: queueUrl.trim(),
    ...(roleArn.trim() ? { roleArn: roleArn.trim() } : {}),
    ...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
  };
}

function useEndpointForm(isOpen: boolean, endpoint: EndpointView | null) {
  const destination = useDestinationFields(isOpen, endpoint);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxBatchSize, setMaxBatchSize] = useState(100);
  const [maxBatchDelayMs, setMaxBatchDelayMs] = useState(250);
  const [maxInFlight, setMaxInFlight] = useState(4);

  useEffect(() => {
    if (!isOpen) return;
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
    ...destination,
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
      destination.isAddressFilled &&
      selected.size > 0 &&
      controlsWithinBounds(maxBatchSize, maxBatchDelayMs, maxInFlight),
    toInput: (): EndpointInput => ({
      ...destination.toDestinationInput(),
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

function DestinationTextField({
  label,
  description,
  placeholder,
  value,
  onChange,
  testId,
  type,
}: {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  type?: "password";
}) {
  return (
    <VStack gap={2} align="start" width="full">
      <HStack gap={1}>
        <Text fontWeight="600" fontSize="sm">
          {label}
        </Text>
        <FieldInfoTooltip description={description} testId={`${testId}-info`} />
      </HStack>
      <Input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // A browser password manager offering to save or fill an AWS secret
        // is not a thing anyone wants; it is also how a stale one gets
        // re-submitted silently.
        autoComplete={type === "password" ? "off" : undefined}
        data-testid={testId}
      />
    </VStack>
  );
}

/**
 * The external id LangWatch sends when it assumes the customer's role. It is
 * read-only because the server mints it, and it is on screen because the
 * trust policy that makes the role usable cannot be written without it.
 */
function ExternalIdField({ externalId }: { externalId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(externalId);
        setCopied(true);
      } catch {
        toaster.create({
          title: "Copy failed. Select the external id and copy it manually.",
          type: "error",
        });
      }
    })();
  };

  return (
    <VStack gap={2} align="start" width="full">
      <HStack gap={1}>
        <Text fontWeight="600" fontSize="sm">
          External id
        </Text>
        <FieldInfoTooltip
          description="Put this in the Condition block of the role's trust policy, as sts:ExternalId. LangWatch sends it on every assume, and AWS refuses the assume when it does not match. It is not a secret: it is worthless to anyone who cannot already assume the role."
          testId="webhook-sqs-external-id-info"
        />
      </HStack>
      <HStack width="full" gap={2}>
        <Code
          flex={1}
          padding={2}
          fontSize="sm"
          wordBreak="break-all"
          data-testid="webhook-sqs-external-id"
        >
          {externalId}
        </Code>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy size={14} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
    </VStack>
  );
}

function SqsDestinationFields({ form }: { form: EndpointForm }) {
  return (
    <>
      <DestinationTextField
        label="Amazon SQS queue URL"
        description="A standard queue, not FIFO. The region and the account that owns the queue are read from this URL. Each delivery is one message whose body is the same signed JSON an HTTPS receiver would get."
        placeholder="https://sqs.eu-central-1.amazonaws.com/123456789012/langwatch-billing-events"
        value={form.queueUrl}
        onChange={form.setQueueUrl}
        testId="webhook-sqs-queue-url"
      />
      <DestinationTextField
        label="Role to assume"
        description="The recommended way to grant access: create a role in your account that may send messages to the queue, and trust LangWatch to assume it. Saving generates an external id to paste into that role's trust policy. Leave this empty to use an access key pair instead."
        placeholder="arn:aws:iam::123456789012:role/langwatch-webhook-producer"
        value={form.roleArn}
        onChange={form.setRoleArn}
        testId="webhook-sqs-role-arn"
      />
      {form.externalId ? <ExternalIdField externalId={form.externalId} /> : null}
      <DestinationTextField
        label="Access key id"
        description="An alternative to assuming a role: a key pair belonging to a user that may send messages to the queue."
        placeholder="AKIA..."
        value={form.accessKeyId}
        onChange={form.setAccessKeyId}
        testId="webhook-sqs-access-key-id"
      />
      <DestinationTextField
        label="Secret access key"
        description="Stored encrypted and never shown again. Leave this empty when editing to keep the one already stored."
        placeholder="Stored encrypted, never shown again"
        value={form.secretAccessKey}
        onChange={form.setSecretAccessKey}
        testId="webhook-sqs-secret-access-key"
        type="password"
      />
    </>
  );
}

/**
 * Where this endpoint delivers, and the address that goes with it.
 *
 * The choice is locked once the endpoint exists: batches already planned
 * against the old transport are in flight, so moving means a new endpoint
 * beside this one until the old one has drained.
 */
function DestinationSection({
  form,
  isEditing,
}: {
  form: EndpointForm;
  isEditing: boolean;
}) {
  return (
    <VStack gap={4} align="start" width="full">
      <VStack gap={2} align="start" width="full">
        <HStack gap={1}>
          <Text fontWeight="600" fontSize="sm">
            Destination
          </Text>
          <FieldInfoTooltip
            description={
              isEditing
                ? "An endpoint keeps the destination it was created with, because deliveries are already queued against it. Create a new endpoint to deliver somewhere else, and archive this one once it has drained."
                : "Where events are delivered. An HTTPS endpoint receives signed POST requests; an Amazon SQS queue receives the same signed body as a message, so nothing is lost when your receiver is down."
            }
            testId="webhook-destination-info"
          />
        </HStack>
        <SegmentedControl
          value={form.destinationKind}
          disabled={isEditing}
          onValueChange={({ value }) =>
            form.setDestinationKind(value as WebhookDestinationKind)
          }
          items={[
            { value: "http", label: WEBHOOK_DESTINATION_LABELS.http },
            { value: "sqs", label: WEBHOOK_DESTINATION_LABELS.sqs },
          ]}
          data-testid="webhook-destination-kind"
        />
      </VStack>
      {form.destinationKind === "sqs" ? (
        <SqsDestinationFields form={form} />
      ) : (
        <EndpointUrlField value={form.url} onChange={form.setUrl} />
      )}
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
    <VStack align="start" gap={2} width="full" data-testid={`webhook-family-${family}`}>
      <Checkbox
        checked={wildcardOn}
        onCheckedChange={({ checked }) => onToggleFamily(family, checked === true)}
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
            onCheckedChange={({ checked }) => onToggleType(t.type, checked === true)}
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
  isEditing,
}: {
  form: EndpointForm;
  eventTypes: readonly EventType[] | undefined;
  isEditing: boolean;
}) {
  return (
    <VStack gap={6} align="start" width="full">
      <DestinationSection form={form} isEditing={isEditing} />
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
          <EndpointFormFields
            form={form}
            eventTypes={eventTypes}
            isEditing={endpoint !== null}
          />
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
