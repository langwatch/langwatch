import { useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "../components/ui/drawer";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";
import {
  isDrawerSwapInProgress,
  NewTracesPromo,
} from "./messages/NewTracesPromo";
import { TraceDetails } from "./traces/TraceDetails";

interface TraceDetailsDrawerProps {
  traceId: string;
  selectedTab?: string;
  showMessages?: boolean;
}

export const TraceDetailsDrawer = (props: TraceDetailsDrawerProps) => {
  const { goBack } = useDrawer();
  const commentState = useAnnotationCommentStore();

  const [traceView, setTraceView] = useState<"span" | "full">("span");

  const toggleView = () => {
    setTraceView((prevView) => (prevView === "span" ? "full" : "span"));
  };

  return (
    <Drawer.Root
      open={true}
      preventScroll={true}
      placement="end"
      size={traceView === "full" ? "full" : "xl"}
      onOpenChange={({ open }) => {
        // Skip the goBack when we're in the middle of swapping to the
        // v2 drawer (NewTracesPromo sets a module-level flag before
        // calling openDrawer). Without this, Chakra's unmount-fired
        // onOpenChange(false) pops the v2 entry off the drawer stack
        // and the operator gets bounced back to v1.
        // URL-based guards proved unreliable across the
        // react-router → React commit → Chakra dispose chain.
        if (open) return;
        if (isDrawerSwapInProgress()) return;
        goBack();
        commentState.resetComment();
      }}
    >
      <Drawer.Content bg="bg"
        paddingX={0}
        maxWidth={traceView === "full" ? undefined : "70%"}
      >
        <Drawer.Body
          paddingY={0}
          paddingX={0}
          overflowY="auto"
          id="conversation-scroll-container"
        >
          <NewTracesPromo variant="compact" traceId={props.traceId} />
          <TraceDetails
            traceId={props.traceId}
            selectedTab={props.selectedTab}
            showMessages={props.showMessages}
            traceView={traceView}
            onToggleView={toggleView}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
