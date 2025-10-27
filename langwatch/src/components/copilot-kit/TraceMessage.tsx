import { HStack, Button, type StackProps } from "@chakra-ui/react";
import { useDrawer } from "../CurrentDrawer";
import { LuListTree } from "react-icons/lu";

interface TraceMessageProps extends StackProps {
  traceId: string;
}

export function TraceMessage({ traceId, ...props }: TraceMessageProps) {
  const { openDrawer, drawerOpen } = useDrawer();
  return (
    <HStack marginTop={-6} paddingBottom={4} {...props}>
      <Button
        onClick={() => {
          if (drawerOpen("traceDetails")) {
            openDrawer(
              "traceDetails",
              {
                traceId: traceId ?? "",
                selectedTab: "traceDetails",
              },
              { replace: true },
            );
          } else {
            openDrawer("traceDetails", {
              traceId: traceId ?? "",
              selectedTab: "traceDetails",
            });
          }
        }}
      >
        <LuListTree />
        View Trace
      </Button>
    </HStack>
  );
}
