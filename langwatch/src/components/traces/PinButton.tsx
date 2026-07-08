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
  // Pin writes are eventually consistent (event-sourced). Keep the optimistic
  // `setData` seed authoritative for a short window instead of letting a
  // focus/remount refetch read the pre-projection summary and flip the button
  // back to "unpinned" until the fold catches up.
  const pinQuery = api.pinnedTrace.getPin.useQuery(
    { projectId, traceId },
    { staleTime: 10_000, refetchOnWindowFocus: false },
  );
  const isPinned = !!pinQuery.data;
  // A `source=share` pin is the system's protection against retention TTL
  // deleting a still-shared trace. The user can't unpin it manually — they
  // have to disable sharing first, which runs `autoUnpin` and clears the
  // pin cleanly. The router rejects the unpin too (defense in depth).
  const isSharePin = pinQuery.data?.source === "share";

  const pinMutation = api.pinnedTrace.pin.useMutation({
    // Pin writes are event-sourced; seed the cache with the optimistic view the
    // mutation returns rather than invalidating, so a refetch that still reads
    // the pre-pin projection doesn't flip the button back.
    onSuccess: (pin) => {
      utils.pinnedTrace.getPin.setData({ projectId, traceId }, pin);
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
      utils.pinnedTrace.getPin.setData({ projectId, traceId }, null);
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
