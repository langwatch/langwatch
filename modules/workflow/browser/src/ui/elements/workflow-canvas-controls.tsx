import { HStack, IconButton } from "@langwatch/design-system/primitives";
import { Panel, useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { Lock, Maximize, Minus, Plus, Unlock } from "lucide-react";

export function WorkflowCanvasControls({ marginLeft }: { marginLeft: string | number }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const store = useStoreApi();
  const interactive = useStore(
    (state) => state.nodesDraggable || state.nodesConnectable || state.elementsSelectable,
  );

  return (
    <Panel position="bottom-left" style={{ marginLeft, marginBottom: "15px" }}>
      <HStack
        gap={0}
        padding={1}
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        boxShadow="sm"
      >
        <IconButton
          aria-label="Zoom in"
          title="Zoom in"
          variant="ghost"
          size="xs"
          onClick={() => void zoomIn()}
        >
          <Plus size={16} />
        </IconButton>
        <IconButton
          aria-label="Zoom out"
          title="Zoom out"
          variant="ghost"
          size="xs"
          onClick={() => void zoomOut()}
        >
          <Minus size={16} />
        </IconButton>
        <IconButton
          aria-label="Fit view"
          title="Fit view"
          variant="ghost"
          size="xs"
          onClick={() => void fitView()}
        >
          <Maximize size={16} />
        </IconButton>
        <IconButton
          aria-label={interactive ? "Lock canvas" : "Unlock canvas"}
          title={interactive ? "Lock canvas" : "Unlock canvas"}
          aria-pressed={!interactive}
          variant="ghost"
          size="xs"
          onClick={() =>
            store.setState({
              nodesDraggable: !interactive,
              nodesConnectable: !interactive,
              elementsSelectable: !interactive,
            })
          }
        >
          {interactive ? <Unlock size={16} /> : <Lock size={16} />}
        </IconButton>
      </HStack>
    </Panel>
  );
}
