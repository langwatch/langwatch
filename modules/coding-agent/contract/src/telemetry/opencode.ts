import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

const OPENCODE_TOOL_SPAN = "opencode.tool.";

/**
 * opencode: scope `com.opencode`, sends BARE event names (`tool_result`, not
 * `opencode.tool_result`) and dots session events (`session.created`).
 * `lines_of_code.total` is unmapped since it duplicates the `.count` delta.
 */
export const opencodeAgent: CodingAgentDefinition = {
  id: "opencode",
  matches: (signal) => signalSays(signal, "opencode"),
  namePrefixes: ["opencode."],

  // opencode puts the tool name IN the span name (`opencode.tool.bash`)
  // while Claude Code and Codex keep the span name constant and carry the
  // tool in an attribute. Reading only the attribute loses every opencode
  // tool; reading only the span name loses everyone else's.
  extractToolNameFromSpanName: (spanName) => {
    if (!spanName.startsWith(OPENCODE_TOOL_SPAN)) return null;
    const tool = spanName.slice(OPENCODE_TOOL_SPAN.length);
    return tool.length > 0 ? tool : null;
  },
};
