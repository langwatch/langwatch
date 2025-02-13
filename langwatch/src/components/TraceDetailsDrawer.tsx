import {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  HStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Maximize2, Minimize2 } from "react-feather";
import { useDrawer } from "./CurrentDrawer";
import { TraceDetails } from "./traces/TraceDetails";
import { useAnnotationCommentStore } from "../hooks/useAnnotationCommentStore";

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
    <Drawer
      isOpen={true}
      blockScrollOnMount={false}
      placement="right"
      size={traceView}
      onClose={() => {
        closeDrawer();
        commentState.resetComment();
      }}
    >
      <DrawerContent paddingX={0}>
        <DrawerBody
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
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
