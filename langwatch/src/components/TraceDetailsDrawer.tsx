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

interface TraceDetailsDrawerProps {
  traceId: string;
  annotationTab?: boolean;
}

export const TraceDetailsDrawer = (props: TraceDetailsDrawerProps) => {
  const { closeDrawer } = useDrawer();

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
      }}
    >
      <DrawerContent paddingX={0}>
        <DrawerBody paddingX={0}>
          <HStack paddingTop={2} paddingLeft={6}>
            {traceView === "span" ? (
              <Maximize2 onClick={toggleView} cursor={"pointer"} />
            ) : (
              <Minimize2 onClick={toggleView} cursor={"pointer"} />
            )}

            <DrawerCloseButton zIndex={1} />
          </HStack>
          <TraceDetails
            traceId={props.traceId}
            annotationTab={props.annotationTab}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
