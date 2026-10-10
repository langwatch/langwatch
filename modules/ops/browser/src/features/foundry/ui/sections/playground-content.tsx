import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Flex, Grid, GridItem, Tabs, Button } from "@langwatch/design-system/primitives";
import { MousePointer2, Plus } from "lucide-react";

import { useTraceStore } from "../../behavior/trace.store.ts";
import { ConnectionSettings } from "./connection-settings.tsx";
import { ExecutionControls } from "./execution-controls.tsx";
import { GraphView } from "./graph-view.tsx";
import { JsonView } from "./json-view.tsx";
import { SpanEditorPanel } from "./span-editor-panel.tsx";
import { SpanTreePanel } from "./span-tree-panel.tsx";
import { TraceSettings } from "./trace-settings.tsx";
import { WaterfallView } from "./waterfall-view.tsx";

export function PlaygroundContent({ compact = false }: { compact?: boolean }) {
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const addSpan = useTraceStore((s) => s.addSpan);
  const sidebarW = compact ? "280px" : "340px";

  return (
    <Grid
      h="full"
      w="full"
      templateColumns={{ base: "minmax(0, 1fr)", md: `${sidebarW} minmax(0, 1fr)` }}
      templateRows={{ base: "minmax(200px, 40%) minmax(0, 1fr)", md: "minmax(0, 1fr)" }}
      overflow="hidden"
    >
      {/* Left sidebar — fixed width, scrolls independently */}
      <GridItem overflow="auto" bg="bg.subtle" borderRight="1px solid" borderColor="border.muted">
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
          colorPalette="accent"
          size="sm"
          display="flex"
          flexDirection="column"
          flex={1}
          overflow="hidden"
          // lazyMount only (no unmountOnExit): the Editor tab holds a draft
          // in React, not the store. Most fields are controlled through to
          // traceStore each keystroke and would survive a remount, but
          // AttributeEditor's uncommitted `newKey` would not.
          lazyMount
        >
          <Tabs.List borderBottom="1px solid" borderColor="border" px={3} gap={0} flexShrink={0}>
            <Tabs.Trigger
              value="editor"
              fontSize="sm"
              px={4}
              py={3}
              color="fg.muted"
              _selected={{ color: "fg.default", borderColor: "accent.solid" }}
            >
              Editor
            </Tabs.Trigger>
            <Tabs.Trigger
              value="waterfall"
              fontSize="sm"
              px={4}
              py={3}
              color="fg.muted"
              _selected={{ color: "fg.default", borderColor: "accent.solid" }}
            >
              Waterfall
            </Tabs.Trigger>
            <Tabs.Trigger
              value="graph"
              fontSize="sm"
              px={4}
              py={3}
              color="fg.muted"
              _selected={{ color: "fg.default", borderColor: "accent.solid" }}
            >
              Graph
            </Tabs.Trigger>
            <Tabs.Trigger
              value="json"
              fontSize="sm"
              px={4}
              py={3}
              color="fg.muted"
              _selected={{ color: "fg.default", borderColor: "accent.solid" }}
            >
              JSON
            </Tabs.Trigger>
          </Tabs.List>

          <Box flex={1} overflow="auto" minH={0}>
            <Tabs.Content value="editor" p={0}>
              {selectedSpanId ? (
                <SpanEditorPanel />
              ) : (
                <Box minHeight="360px" display="flex" alignItems="center" padding={6}>
                  <NoDataInfoBlock
                    icon={<MousePointer2 />}
                    title="Select a span to edit"
                    description="Choose a span from the trace tree to edit its input, output, timing, and attributes."
                  >
                    <Button size="sm" colorPalette="accent" onClick={() => addSpan(null, "llm")}>
                      <Plus size={16} /> Add LLM span
                    </Button>
                  </NoDataInfoBlock>
                </Box>
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
