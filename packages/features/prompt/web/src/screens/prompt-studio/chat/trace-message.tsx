/**
 * The "View Trace" affordance beside a chat turn that produced a trace.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/components/copilot-kit/TraceMessage.tsx` (three other
 * callers, un-repointable). Two things did not travel and both are recorded:
 *
 * - The hover-peek popover is `features/traces-v2`'s `TracePreviewHoverCard`,
 *   application internals a package may not reach and which
 *   `@langwatch/trace-web` does not publish. Hovering the button no longer
 *   shows the compact summary; clicking it still opens the trace.
 * - The drawer itself is `platform/app`'s registered `traceV2Details`, opened
 *   by most of the product, so this move may neither delete nor copy it. The
 *   button names the drawer and the host writes the address. KNOWN GAP, shared
 *   with the me, automations, agents and model-config families: nothing mounts
 *   that registry above a screen served from `apps/ui` until the chrome layout
 *   route exists, so the address is right and the drawer does not open yet.
 *
 * The existence probe stays: a trace lands a moment after the run finishes, and
 * offering a button that opens nothing is worse than offering it late.
 */

import { Button, HStack, type StackProps } from "@chakra-ui/react";
import { LuListTree } from "react-icons/lu";
import { promptApi } from "../../../behavior/prompt-api";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { usePromptHost } from "../../../model/prompt-host";

export const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) => Math.min(2000 * 2 ** attemptIndex, 60000),
  // Traces are immutable once written, so caching forever is correct.
  staleTime: Infinity,
  gcTime: Infinity,
} as const;

interface TraceMessageProps extends StackProps {
  traceId: string;
}

export function TraceMessage({ traceId, ...props }: TraceMessageProps) {
  const { project } = usePromptProject();
  const host = usePromptHost();

  const traceQuery = promptApi.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project && !!traceId, ...TRACE_QUERY_CONFIG },
  );

  if (traceQuery.isLoading || traceQuery.isError || !traceQuery.data) {
    return null;
  }

  return (
    <HStack paddingBottom={4} {...props}>
      <Button
        colorPalette="gray"
        onClick={() => host.openPlatformDrawer({ drawer: "traceV2Details", params: { traceId } })}
      >
        <LuListTree />
        View Trace
      </Button>
    </HStack>
  );
}
