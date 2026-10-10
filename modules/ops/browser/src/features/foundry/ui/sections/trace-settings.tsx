import { Box, Input, Text, VStack } from "@langwatch/design-system/primitives";

import { useTraceStore } from "../../behavior/trace.store.ts";

export function TraceSettings({ compact = false }: { compact?: boolean }) {
  const trace = useTraceStore((s) => s.trace);
  const updateTrace = useTraceStore((s) => s.updateTrace);

  return (
    <Box p={4}>
      <Text
        fontSize="xs"
        fontWeight="medium"
        textTransform="none"
        letterSpacing="normal"
        color="fg.muted"
        mb={2}
      >
        Trace settings
      </Text>
      <VStack gap={2} align="stretch">
        <Box>
          <Text fontSize="xs" color="fg.subtle" mb={1}>
            Service name
          </Text>
          <Input
            size="sm"
            aria-label="Service name"
            value={trace.resourceAttributes["service.name"] ?? ""}
            onChange={(e) =>
              updateTrace({
                resourceAttributes: {
                  ...trace.resourceAttributes,
                  "service.name": e.target.value,
                },
              })
            }
          />
        </Box>
        <Box>
          <Text fontSize="xs" color="fg.subtle" mb={1}>
            User ID
          </Text>
          <Input
            size="sm"
            aria-label="User ID"
            value={trace.metadata.userId ?? ""}
            onChange={(e) =>
              updateTrace({
                metadata: {
                  ...trace.metadata,
                  userId: e.target.value || undefined,
                },
              })
            }
            placeholder="optional"
          />
        </Box>
        {!compact && (
          <>
            <Box>
              <Text fontSize="xs" color="fg.subtle" mb={1}>
                Thread ID
              </Text>
              <Input
                size="sm"
                aria-label="Thread ID"
                value={trace.metadata.threadId ?? ""}
                onChange={(e) =>
                  updateTrace({
                    metadata: {
                      ...trace.metadata,
                      threadId: e.target.value || undefined,
                    },
                  })
                }
                placeholder="optional"
              />
            </Box>
            <Box>
              <Text fontSize="xs" color="fg.subtle" mb={1}>
                Labels
              </Text>
              <Input
                size="sm"
                aria-label="Labels"
                value={trace.metadata.labels?.join(", ") ?? ""}
                onChange={(e) =>
                  updateTrace({
                    metadata: {
                      ...trace.metadata,
                      labels: e.target.value
                        ? e.target.value.split(",").map((l) => l.trim())
                        : undefined,
                    },
                  })
                }
                placeholder="e.g. production, v2"
              />
            </Box>
          </>
        )}
      </VStack>
    </Box>
  );
}
