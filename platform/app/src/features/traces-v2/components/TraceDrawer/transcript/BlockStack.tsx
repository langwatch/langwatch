import { TraceMediaPart } from "~/components/traces/TraceMediaPart";
import { TerminalOutput } from "@langwatch/coding-agent-web";
import {
  BlockStack as TraceWebBlockStack,
  TranscriptRenderProvider,
  type BlockStackProps,
} from "@langwatch/trace-web";

export { pairToolBlocks, reparseTextBlock } from "@langwatch/trace-web";

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
