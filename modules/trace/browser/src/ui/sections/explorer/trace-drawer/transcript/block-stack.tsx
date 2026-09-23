import { TerminalOutput } from "@langwatch/coding-agent-browser-kit";

import { TranscriptRenderProvider } from "../../../../elements/transcript-render-ports.tsx";
import { TraceMediaPart } from "../../../traces/trace-media-part.tsx";
import {
  BlockStack as TraceWebBlockStack,
  type BlockStackProps,
} from "../../../transcript/block-stack.tsx";

export { pairToolBlocks } from "../../../../../model/transcript/block-stack-items.ts";
export { reparseTextBlock } from "../../../../../model/transcript/reparse-text-block.ts";

export function BlockStack(props: BlockStackProps) {
  return (
    <TranscriptRenderProvider
      renderMediaPart={(part) => <TraceMediaPart part={part} />}
      renderTerminalOutput={(text, isError) => <TerminalOutput text={text} isError={isError} />}
    >
      <TraceWebBlockStack {...props} />
    </TranscriptRenderProvider>
  );
}
