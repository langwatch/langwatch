import { DatabaseSchema } from "@prisma/client";

export function schemaDisplayName(value: DatabaseSchema): string {
  switch (value) {
    case DatabaseSchema.FULL_TRACE:
      return "Full Trace";
    case DatabaseSchema.LLM_CHAT_CALL:
      return "LLM Chat Call";
    case DatabaseSchema.STRING_I_O:
      return "String I/O";
    case DatabaseSchema.KEY_VALUE:
      return "Key Value";
    case DatabaseSchema.ONE_MESSAGE_PER_ROW:
      return "One Message Per Row";
    case DatabaseSchema.ONE_LLM_CALL_PER_ROW:
      return "One LLM Call Per Row";
    default:
      return "";
  }
}
