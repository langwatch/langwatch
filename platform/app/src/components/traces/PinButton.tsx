import { Button } from "@chakra-ui/react";
import { PinSource } from "@prisma/client";
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
  // A `source=share` pin is the system's protection against retention TTL
  // deleting a still-shared trace. The user can't unpin it manually — they
  // have to disable sharing first, which runs `autoUnpin` and clears the
  // pin cleanly. The router rejects the unpin too (defense in depth).
  const isSharePin = pinQuery.data?.source === PinSource.share;

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

  const tooltipContent = isSharePin
    ? "Auto-pinned because this trace is shared. Disable the share to unpin."
    : isPinned
      ? "Unpin trace"
      : "Pin trace (mark as important)";
  const disabled = isLoading || isSharePin;

  return (
    <Tooltip content={tooltipContent}>
      <Button
        data-scope="header"
        colorPalette={isPinned ? "orange" : "gray"}
        size="sm"
        loading={isLoading}
        disabled={disabled}
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
