import { Box, Flex, Grid, GridItem, Tabs, Text } from "@chakra-ui/react";
import { ConnectionSettings } from "./ConnectionSettings";
import { ExecutionControls } from "./ExecutionControls";
import { SpanEditorPanel } from "./SpanEditorPanel";
import { SpanTreePanel } from "./SpanTreePanel";
import { TraceSettings } from "./TraceSettings";
import { useTraceStore } from "./traceStore";
import { GraphView } from "./views/GraphView";
import { JsonView } from "./views/JsonView";
import { WaterfallView } from "./views/WaterfallView";

export function PlaygroundContent({ compact = false }: { compact?: boolean }) {
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const sidebarW = compact ? "260px" : "300px";

  return (
    <Grid
      h="full"
      w="full"
      templateColumns={`${sidebarW} minmax(0, 1fr)`}
      overflow="hidden"
    >
      {/* Left sidebar — fixed width, scrolls independently */}
      <GridItem overflow="auto" borderRight="1px solid" borderColor="border">
        <Flex direction="column" minH="full">
          <ConnectionSettings compact={compact} />
          <Box borderTop="1px solid" borderColor="border">
            <TraceSettings compact={compact} />
          </Box>
          <Box borderTop="1px solid" borderColor="border" flex={1}>
            <SpanTreePanel />
          </Box>
          <Box borderTop="1px solid" borderColor="border">
            <ExecutionControls compact={compact} />
          </Box>
        </Flex>
      </GridItem>

      {/* Right pane — minmax(0,1fr) prevents blowout */}
      <GridItem overflow="hidden" display="flex" flexDirection="column">
        <Tabs.Root
          defaultValue="editor"
          variant="line"
          size="sm"
          display="flex"
          flexDirection="column"
          flex={1}
          overflow="hidden"
          // lazyMount only (no unmountOnExit): the Editor tab holds a draft
          // that lives in React rather than the store. SpanEditorPanel's own
          // fields are controlled straight through to the traceStore on each
          // keystroke, so those would survive a remount; the one that would
          // not is AttributeEditor's `newKey`: an attribute name typed but
          // not yet committed with Add. Inactive tabs are therefore only
          // skipped until first opened, then kept mounted.
          lazyMount
        >
          <Tabs.List
            borderBottom="1px solid"
            borderColor="border"
            px={3}
            gap={0}
            flexShrink={0}
          >
            <Tabs.Trigger
              value="editor"
              fontSize="xs"
              px={3}
              py={1.5}
              color="fg.muted"
              _selected={{
                color: "fg.default",
                borderColor: "orange.emphasized",
              }}
            >
              Editor
            </Tabs.Trigger>
            <Tabs.Trigger
              value="waterfall"
              fontSize="xs"
              px={3}
              py={1.5}
              color="fg.muted"
              _selected={{
                color: "fg.default",
                borderColor: "orange.emphasized",
              }}
            >
              Waterfall
            </Tabs.Trigger>
            <Tabs.Trigger
              value="graph"
              fontSize="xs"
              px={3}
              py={1.5}
              color="fg.muted"
              _selected={{
                color: "fg.default",
                borderColor: "orange.emphasized",
              }}
            >
              Graph
            </Tabs.Trigger>
            <Tabs.Trigger
              value="json"
              fontSize="xs"
              px={3}
              py={1.5}
              color="fg.muted"
              _selected={{
                color: "fg.default",
                borderColor: "orange.emphasized",
              }}
            >
              JSON
            </Tabs.Trigger>
          </Tabs.List>

          <Box flex={1} overflow="auto" minH={0}>
            <Tabs.Content value="editor" p={0}>
              {selectedSpanId ? (
                <SpanEditorPanel />
              ) : (
                <Flex
                  h="300px"
                  align="center"
                  justify="center"
                  color="fg.muted"
                >
                  <Box textAlign="center">
                    <Text fontSize="md">Select a span to edit</Text>
                    <Text fontSize="sm" mt={1}>
                      Or add a new span from the tree
                    </Text>
                  </Box>
                </Flex>
              )}
            </Tabs.Content>
            <Tabs.Content value="waterfall" p={0}>
              <WaterfallView />
            </Tabs.Content>
            <Tabs.Content value="graph" p={0} h="full">
              <GraphView />
            </Tabs.Content>
            <Tabs.Content value="json" p={0} h="full">
              <JsonView />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </GridItem>
    </Grid>
  );
}
