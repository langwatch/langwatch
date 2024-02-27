import { DatabaseSchema } from "@prisma/client";


export function displayName(value: DatabaseSchema): string {
    switch (value) {
        case DatabaseSchema.FULL_TRACE:
            return 'Full Trace';
        case DatabaseSchema.LLM_CHAT_CALL:
            return 'LLM Chat Call';
        case DatabaseSchema.STRING_I_O:
            return 'String I/O';
        case DatabaseSchema.KEY_VALUE:
            return 'Key Value';
        default:
            return '';
    }
}