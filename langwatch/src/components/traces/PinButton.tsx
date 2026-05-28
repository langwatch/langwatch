import { Button } from "@chakra-ui/react";
import { Pin, PinOff } from "lucide-react";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";

export function PinButton({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
}) {
  const utils = api.useUtils();
  const pinQuery = api.pinnedTrace.getPin.useQuery({ projectId, traceId });
  const isPinned = !!pinQuery.data;

  const pinMutation = api.pinnedTrace.pin.useMutation({
    onSuccess: () => {
      utils.pinnedTrace.getPin.invalidate({ projectId, traceId });
      toaster.create({ title: "Trace pinned", type: "success" });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to pin trace",
        description: error.message,
        type: "error",
      });
    },
  });

  const unpinMutation = api.pinnedTrace.unpin.useMutation({
    onSuccess: () => {
      utils.pinnedTrace.getPin.invalidate({ projectId, traceId });
      toaster.create({ title: "Trace unpinned", type: "success" });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to unpin trace",
        description: error.message,
        type: "error",
      });
    },
  });

  const isLoading = pinMutation.isLoading || unpinMutation.isLoading;

  return (
    <Tooltip content={isPinned ? "Unpin trace" : "Pin trace (mark as important)"}>
      <Button
        data-scope="header"
        colorPalette={isPinned ? "orange" : "gray"}
        size="sm"
        loading={isLoading}
        onClick={() => {
          if (isPinned) {
            unpinMutation.mutate({ projectId, traceId });
          } else {
            pinMutation.mutate({ projectId, traceId });
          }
        }}
      >
        {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
        {isPinned ? "Unpin" : "Pin"}
      </Button>
    </Tooltip>
  );
}
