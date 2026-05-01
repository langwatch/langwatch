import {
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { useColorMode } from "~/components/ui/color-mode";
import { Dialog } from "~/components/ui/dialog";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useSpansFull } from "../../hooks/useSpansFull";
import { ShikiCodeBlock } from "./markdownView";
import { SegmentedToggle } from "./SegmentedToggle";

const COPY_FEEDBACK_MS = 1500;

type RawTab = "trace" | "spans";

interface RawJsonDialogProps {
  open: boolean;
  onClose: () => void;
  trace: TraceHeader;
}

export function RawJsonDialog({ open, onClose, trace }: RawJsonDialogProps) {
  const [tab, setTab] = useState<RawTab>("trace");
  const { colorMode } = useColorMode();
  const spansQuery = useSpansFull(open);

  const traceJson = useMemo(() => JSON.stringify(trace, null, 2), [trace]);
  const spansJson = useMemo(
    () => (spansQuery.data ? JSON.stringify(spansQuery.data, null, 2) : null),
    [spansQuery.data],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="xl"
      placement="center"
    >
      <Dialog.Content maxHeight="85vh" display="flex" flexDirection="column">
        <Dialog.Header borderBottomWidth="1px" borderColor="border">
          <HStack gap={3} align="center">
            <Dialog.Title>
              <Text textStyle="md" fontWeight="semibold">
                Raw JSON
              </Text>
            </Dialog.Title>
            <SegmentedToggle
              value={tab}
              onChange={(t) => setTab(t as RawTab)}
              options={["trace", "spans"]}
            />
            <Box flex={1} />
            <CopyButton
              payload={tab === "trace" ? traceJson : (spansJson ?? "")}
              disabled={tab === "spans" && !spansJson}
            />
          </HStack>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body
          padding={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          flex={1}
        >
          {tab === "trace" ? (
            <Box flex={1} overflow="auto">
              <ShikiCodeBlock
                code={traceJson}
                language="json"
                colorMode={colorMode}
                flush
              />
            </Box>
          ) : spansQuery.isLoading ? (
            <VStack gap={2} paddingY={8} flex={1} justify="center">
              <Spinner size="sm" color="blue.fg" />
              <Text textStyle="xs" color="fg.muted">
                Loading spans…
              </Text>
            </VStack>
          ) : spansJson ? (
            <Box flex={1} overflow="auto">
              <ShikiCodeBlock
                code={spansJson}
                language="json"
                colorMode={colorMode}
                flush
              />
            </Box>
          ) : (
            <VStack gap={2} paddingY={8} flex={1} justify="center">
              <Text textStyle="xs" color="fg.muted">
                Failed to load spans
              </Text>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void spansQuery.refetch()}
              >
                Retry
              </Button>
            </VStack>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function CopyButton({
  payload,
  disabled,
}: {
  payload: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    void navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleClick}
      disabled={disabled}
      aria-label="Copy raw JSON"
      gap={1.5}
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
      <Text textStyle="2xs" color="fg.muted">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
  );
}
