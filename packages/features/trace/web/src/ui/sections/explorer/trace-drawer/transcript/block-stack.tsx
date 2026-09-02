import { TraceMediaPart } from "../../../traces/trace-media-part";
import { TerminalOutput } from "@langwatch/coding-agent-web";
import {
  BlockStack as TraceWebBlockStack,
  TranscriptRenderProvider,
  type BlockStackProps,
} from "../../../../../index";

export { pairToolBlocks, reparseTextBlock } from "../../../../../index";

export function BlockStack(props: BlockStackProps) {
  return (
    <TranscriptRenderProvider
      renderMediaPart={(part) => <TraceMediaPart part={part} />}
      renderTerminalOutput={(text, isError) => (
        <TerminalOutput text={text} isError={isError} />
      )}
    >
      <TraceWebBlockStack {...props} />
    </TranscriptRenderProvider>
  );
}
