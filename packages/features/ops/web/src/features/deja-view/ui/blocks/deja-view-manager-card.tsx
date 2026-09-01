import { Badge, Box, HStack, Spacer, Text, VStack, Wrap } from "@chakra-ui/react";

import { formatTimeAgo } from "../../../../model/ops-formatters";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer";

export interface DejaViewProcessManagerOutboxMessage {
  messageKey: string;
  intentType: string;
  attempts: number;
  status: "pending" | "dispatched" | "dead" | "discarded";
}

export interface DejaViewProcessManagerInstance {
  revision: number;
  updatedAt: number;
  nextWakeAt: number | null;
  state: unknown;
}

export interface DejaViewProcessManager {
  processName: string;
  eventTypes: readonly string[];
  intentTypes: readonly string[];
  instance: DejaViewProcessManagerInstance | null;
  outbox: DejaViewProcessManagerOutboxMessage[];
}

const OUTBOX_PALETTE: Record<DejaViewProcessManagerOutboxMessage["status"], string> = {
  pending: "yellow",
  dispatched: "green",
  dead: "red",
  discarded: "gray",
};

function instanceStatus(instance: DejaViewProcessManagerInstance | null): {
  label: string;
  palette: string;
} {
  if (!instance) return { label: "Not started", palette: "gray" };
  if (instance.nextWakeAt !== null && instance.nextWakeAt > Date.now()) {
    return { label: "Waiting to wake", palette: "blue" };
  }
  return { label: "Active", palette: "green" };
}

function Chips({ items, palette }: { items: readonly string[]; palette: string }) {
  return (
    <Wrap gap={1}>
      {items.map((item) => (
        <Badge key={item} colorPalette={palette} variant="subtle" size="sm">
          {item}
        </Badge>
      ))}
    </Wrap>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text
        textStyle="2xs"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
        marginBottom={1}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}

function EmittedCommands({ outbox }: { outbox: DejaViewProcessManagerOutboxMessage[] }) {
  return (
    <Field label="Emitted commands">
      <VStack align="stretch" gap={1}>
        {outbox.map((msg) => (
          <HStack key={msg.messageKey} gap={2}>
            <Text textStyle="xs" fontFamily="mono" truncate>
              {msg.intentType}
            </Text>
            <Spacer />
            {msg.attempts > 0 && (
              <Text textStyle="2xs" color="fg.muted">
                ×{msg.attempts}
              </Text>
            )}
            <Badge colorPalette={OUTBOX_PALETTE[msg.status]} variant="subtle" size="sm">
              {msg.status}
            </Badge>
          </HStack>
        ))}
      </VStack>
    </Field>
  );
}

export function ManagerCard({ manager }: { manager: DejaViewProcessManager }) {
  const status = instanceStatus(manager.instance);
  const { instance } = manager;

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" padding={3}>
      <VStack align="stretch" gap={3}>
        <HStack gap={2}>
          <Text fontWeight="semibold" textStyle="sm" truncate>
            {manager.processName}
          </Text>
          <Spacer />
          <Badge colorPalette={status.palette} variant="subtle">
            {status.label}
          </Badge>
        </HStack>

        <Field label="Triggers">
          <Chips items={manager.eventTypes} palette="blue" />
        </Field>
        {manager.intentTypes.length > 0 && (
          <Field label="Emits">
            <Chips items={manager.intentTypes} palette="purple" />
          </Field>
        )}

        {instance ? (
          <>
            <HStack gap={4} flexWrap="wrap">
              <Text textStyle="xs" color="fg.muted">
                rev {instance.revision}
              </Text>
              <Text textStyle="xs" color="fg.muted">
                updated {formatTimeAgo(instance.updatedAt)}
              </Text>
              <Text textStyle="xs" color="fg.muted">
                next wake {formatTimeAgo(instance.nextWakeAt)}
              </Text>
            </HStack>
            <Field label="State">
              <JsonViewer data={instance.state} maxHeight="220px" />
            </Field>
            {manager.outbox.length > 0 && <EmittedCommands outbox={manager.outbox} />}
          </>
        ) : (
          <Text textStyle="xs" color="fg.muted">
            This machine has not started for this aggregate.
          </Text>
        )}
      </VStack>
    </Box>
  );
}
