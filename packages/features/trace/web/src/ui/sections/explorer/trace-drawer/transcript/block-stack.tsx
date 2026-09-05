import { TraceMediaPart } from "../../../traces/trace-media-part";
import { TerminalOutput } from "@langwatch/coding-agent-web/surfaces/agent-traces";
import { TranscriptRenderProvider } from "../../../../elements/transcript-render-ports";
import {
  BlockStack as TraceWebBlockStack,
  type BlockStackProps,
} from "../../../transcript/block-stack";

export { pairToolBlocks, reparseTextBlock } from "../../../../../index";

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
