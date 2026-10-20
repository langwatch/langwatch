import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Flex, Grid, GridItem, Button } from "@langwatch/design-system/primitives";
import { MousePointer2, Plus } from "lucide-react";
import { useState } from "react";

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
  const [view, setView] = useState("editor");
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
        <ContentTabs
          label="Trace view"
          value={view}
          onValueChange={({ value }) => setView(value)}
          density="compact"
          body="flush"
          scroll="panel"
          // Lazy mounting keeps a visited tab: the Editor tab holds a draft in React, not
          // the store, and AttributeEditor's uncommitted `newKey` would not survive a remount.
          mount="lazy"
          items={[
            {
              value: "editor",
              label: "Editor",
              content: selectedSpanId ? (
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
              ),
            },
            { value: "waterfall", label: "Waterfall", content: <WaterfallView /> },
            {
              value: "graph",
              label: "Graph",
              content: (
                <Box height="full">
                  <GraphView />
                </Box>
              ),
            },
            {
              value: "json",
              label: "JSON",
              content: (
                <Box height="full">
                  <JsonView />
                </Box>
              ),
            },
          ]}
        />
      </GridItem>
    </Grid>
  );
}
