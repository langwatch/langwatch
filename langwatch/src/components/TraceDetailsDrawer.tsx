import { useState } from "react";
import { Drawer } from "../components/ui/drawer";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";
import { useDrawer } from "./CurrentDrawer";
import { TraceDetails } from "./traces/TraceDetails";

interface TraceDetailsDrawerProps {
  traceId: string;
  selectedTab?: string;
  showMessages?: boolean;
}

export const TraceDetailsDrawer = (props: TraceDetailsDrawerProps) => {
  const { closeDrawer } = useDrawer();
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
      onOpenChange={() => {
        closeDrawer();
        commentState.resetComment();
      }}
    >
      <Drawer.Backdrop />
      <Drawer.Content
        paddingX={0}
        maxWidth={traceView === "full" ? undefined : "70%"}
      >
        <Drawer.Body
          paddingTop={0}
          paddingX={0}
          overflowY="auto"
          id="conversation-scroll-container"
        >
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
