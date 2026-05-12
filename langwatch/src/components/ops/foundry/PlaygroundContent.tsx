import { Box, Flex, Text, Tabs, Grid, GridItem } from "@chakra-ui/react";
import { SpanTreePanel } from "./SpanTreePanel";
import { SpanEditorPanel } from "./SpanEditorPanel";
import { ConnectionSettings } from "./ConnectionSettings";
import { ExecutionControls } from "./ExecutionControls";
import { TraceSettings } from "./TraceSettings";
import { WaterfallView } from "./views/WaterfallView";
import { GraphView } from "./views/GraphView";
import { JsonView } from "./views/JsonView";
import { useTraceStore } from "./traceStore";

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
      <GridItem
        overflow="auto"
        borderRight="1px solid"
        borderColor="border"
      >
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
        <Tabs.Root defaultValue="editor" variant="line" size="sm" display="flex" flexDirection="column" flex={1} overflow="hidden">
          <Tabs.List borderBottom="1px solid" borderColor="border" px={3} gap={0} flexShrink={0}>
            <Tabs.Trigger value="editor" fontSize="xs" px={3} py={1.5} color="fg.muted" _selected={{ color: "fg.default", borderColor: "orange.500" }}>
              Editor
            </Tabs.Trigger>
            <Tabs.Trigger value="waterfall" fontSize="xs" px={3} py={1.5} color="fg.muted" _selected={{ color: "fg.default", borderColor: "orange.500" }}>
              Waterfall
            </Tabs.Trigger>
            <Tabs.Trigger value="graph" fontSize="xs" px={3} py={1.5} color="fg.muted" _selected={{ color: "fg.default", borderColor: "orange.500" }}>
              Graph
            </Tabs.Trigger>
            <Tabs.Trigger value="json" fontSize="xs" px={3} py={1.5} color="fg.muted" _selected={{ color: "fg.default", borderColor: "orange.500" }}>
              JSON
            </Tabs.Trigger>
          </Tabs.List>

          <Box flex={1} overflow="auto" minH={0}>
            <Tabs.Content value="editor" p={0}>
              {selectedSpanId ? (
                <SpanEditorPanel />
              ) : (
                <Flex h="300px" align="center" justify="center" color="fg.muted">
                  <Box textAlign="center">
                    <Text fontSize="md">Select a span to edit</Text>
                    <Text fontSize="sm" mt={1}>Or add a new span from the tree</Text>
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
