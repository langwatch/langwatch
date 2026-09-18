import { z } from 'zod';
import { Observable } from 'rxjs';

declare const FunctionCallSchema: z.ZodObject<{
    name: z.ZodString;
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    arguments: string;
}, {
    name: string;
    arguments: string;
}>;
declare const ToolCallSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"function">;
    function: z.ZodObject<{
        name: z.ZodString;
        arguments: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        arguments: string;
    }, {
        name: string;
        arguments: string;
    }>;
}, "strip", z.ZodTypeAny, {
    function: {
        name: string;
        arguments: string;
    };
    type: "function";
    id: string;
}, {
    function: {
        name: string;
        arguments: string;
    };
    type: "function";
    id: string;
}>;
declare const BaseMessageSchema: z.ZodObject<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: string;
    name?: string | undefined;
    content?: string | undefined;
}, {
    id: string;
    role: string;
    name?: string | undefined;
    content?: string | undefined;
}>;
declare const DeveloperMessageSchema: z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"developer">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "developer";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "developer";
    content: string;
    name?: string | undefined;
}>;
declare const SystemMessageSchema: z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"system">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "system";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "system";
    content: string;
    name?: string | undefined;
}>;
declare const AssistantMessageSchema: z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"assistant">;
    content: z.ZodOptional<z.ZodString>;
    toolCalls: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"function">;
        function: z.ZodObject<{
            name: z.ZodString;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            arguments: string;
        }, {
            name: string;
            arguments: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }>, "many">>;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "assistant";
    name?: string | undefined;
    content?: string | undefined;
    toolCalls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
}, {
    id: string;
    role: "assistant";
    name?: string | undefined;
    content?: string | undefined;
    toolCalls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
}>;
declare const UserMessageSchema: z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"user">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "user";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "user";
    content: string;
    name?: string | undefined;
}>;
declare const ToolMessageSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    role: z.ZodLiteral<"tool">;
    toolCallId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: "tool";
    content: string;
    toolCallId: string;
}, {
    id: string;
    role: "tool";
    content: string;
    toolCallId: string;
}>;
declare const MessageSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"developer">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "developer";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "developer";
    content: string;
    name?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"system">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "system";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "system";
    content: string;
    name?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"assistant">;
    content: z.ZodOptional<z.ZodString>;
    toolCalls: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"function">;
        function: z.ZodObject<{
            name: z.ZodString;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            arguments: string;
        }, {
            name: string;
            arguments: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }>, "many">>;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "assistant";
    name?: string | undefined;
    content?: string | undefined;
    toolCalls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
}, {
    id: string;
    role: "assistant";
    name?: string | undefined;
    content?: string | undefined;
    toolCalls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    id: z.ZodString;
    role: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, {
    role: z.ZodLiteral<"user">;
    content: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    id: string;
    role: "user";
    content: string;
    name?: string | undefined;
}, {
    id: string;
    role: "user";
    content: string;
    name?: string | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    role: z.ZodLiteral<"tool">;
    toolCallId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: "tool";
    content: string;
    toolCallId: string;
}, {
    id: string;
    role: "tool";
    content: string;
    toolCallId: string;
}>]>;
declare const RoleSchema: z.ZodUnion<[z.ZodLiteral<"developer">, z.ZodLiteral<"system">, z.ZodLiteral<"assistant">, z.ZodLiteral<"user">, z.ZodLiteral<"tool">]>;
declare const ContextSchema: z.ZodObject<{
    description: z.ZodString;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    description: string;
}, {
    value: string;
    description: string;
}>;
declare const ToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    parameters: z.ZodAny;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    parameters?: any;
}, {
    name: string;
    description: string;
    parameters?: any;
}>;
declare const RunAgentInputSchema: z.ZodObject<{
    threadId: z.ZodString;
    runId: z.ZodString;
    state: z.ZodAny;
    messages: z.ZodArray<z.ZodDiscriminatedUnion<"role", [z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"developer">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"system">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"assistant">;
        content: z.ZodOptional<z.ZodString>;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"function">;
            function: z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }>, "many">>;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"user">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        role: z.ZodLiteral<"tool">;
        toolCallId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }>]>, "many">;
    tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        parameters: z.ZodAny;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        parameters?: any;
    }, {
        name: string;
        description: string;
        parameters?: any;
    }>, "many">;
    context: z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        description: string;
    }, {
        value: string;
        description: string;
    }>, "many">;
    forwardedProps: z.ZodAny;
}, "strip", z.ZodTypeAny, {
    threadId: string;
    runId: string;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    tools: {
        name: string;
        description: string;
        parameters?: any;
    }[];
    context: {
        value: string;
        description: string;
    }[];
    state?: any;
    forwardedProps?: any;
}, {
    threadId: string;
    runId: string;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    tools: {
        name: string;
        description: string;
        parameters?: any;
    }[];
    context: {
        value: string;
        description: string;
    }[];
    state?: any;
    forwardedProps?: any;
}>;
declare const StateSchema: z.ZodAny;
type ToolCall = z.infer<typeof ToolCallSchema>;
type FunctionCall = z.infer<typeof FunctionCallSchema>;
type DeveloperMessage = z.infer<typeof DeveloperMessageSchema>;
type SystemMessage = z.infer<typeof SystemMessageSchema>;
type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
type UserMessage = z.infer<typeof UserMessageSchema>;
type ToolMessage = z.infer<typeof ToolMessageSchema>;
type Message = z.infer<typeof MessageSchema>;
type Context = z.infer<typeof ContextSchema>;
type Tool = z.infer<typeof ToolSchema>;
type RunAgentInput = z.infer<typeof RunAgentInputSchema>;
type State = z.infer<typeof StateSchema>;
type Role = z.infer<typeof RoleSchema>;
declare class AGUIError extends Error {
    constructor(message: string);
}

declare enum EventType {
    TEXT_MESSAGE_START = "TEXT_MESSAGE_START",
    TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT",
    TEXT_MESSAGE_END = "TEXT_MESSAGE_END",
    TEXT_MESSAGE_CHUNK = "TEXT_MESSAGE_CHUNK",
    TOOL_CALL_START = "TOOL_CALL_START",
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS",
    TOOL_CALL_END = "TOOL_CALL_END",
    TOOL_CALL_CHUNK = "TOOL_CALL_CHUNK",
    STATE_SNAPSHOT = "STATE_SNAPSHOT",
    STATE_DELTA = "STATE_DELTA",
    MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT",
    RAW = "RAW",
    CUSTOM = "CUSTOM",
    RUN_STARTED = "RUN_STARTED",
    RUN_FINISHED = "RUN_FINISHED",
    RUN_ERROR = "RUN_ERROR",
    STEP_STARTED = "STEP_STARTED",
    STEP_FINISHED = "STEP_FINISHED"
}
declare const BaseEventSchema: z.ZodObject<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    type: EventType;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunStartedSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_STARTED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunFinishedSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_FINISHED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunErrorSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_ERROR>;
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const StepStartedSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_STARTED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const StepFinishedSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_FINISHED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const TextMessageStartEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_START>;
    messageId: z.ZodString;
    role: z.ZodLiteral<"assistant">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_START;
    role: "assistant";
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_START;
    role: "assistant";
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const TextMessageContentEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_CONTENT>;
    messageId: z.ZodString;
    delta: z.ZodEffects<z.ZodString, string, string>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_CONTENT;
    messageId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_CONTENT;
    messageId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const TextMessageEndEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_END>;
    messageId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_END;
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_END;
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const TextMessageChunkEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_CHUNK>;
    messageId: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodLiteral<"assistant">>;
    delta: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_CHUNK;
    role?: "assistant" | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    messageId?: string | undefined;
    delta?: string | undefined;
}, {
    type: EventType.TEXT_MESSAGE_CHUNK;
    role?: "assistant" | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    messageId?: string | undefined;
    delta?: string | undefined;
}>;
declare const ToolCallStartEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_START>;
    toolCallId: z.ZodString;
    toolCallName: z.ZodString;
    parentMessageId: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_START;
    toolCallId: string;
    toolCallName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
    parentMessageId?: string | undefined;
}, {
    type: EventType.TOOL_CALL_START;
    toolCallId: string;
    toolCallName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
    parentMessageId?: string | undefined;
}>;
declare const ToolCallArgsEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_ARGS>;
    toolCallId: z.ZodString;
    delta: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_ARGS;
    toolCallId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TOOL_CALL_ARGS;
    toolCallId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const ToolCallEndEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_END>;
    toolCallId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_END;
    toolCallId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TOOL_CALL_END;
    toolCallId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const ToolCallChunkEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_CHUNK>;
    toolCallId: z.ZodOptional<z.ZodString>;
    toolCallName: z.ZodOptional<z.ZodString>;
    parentMessageId: z.ZodOptional<z.ZodString>;
    delta: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_CHUNK;
    toolCallId?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    delta?: string | undefined;
    toolCallName?: string | undefined;
    parentMessageId?: string | undefined;
}, {
    type: EventType.TOOL_CALL_CHUNK;
    toolCallId?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    delta?: string | undefined;
    toolCallName?: string | undefined;
    parentMessageId?: string | undefined;
}>;
declare const StateSnapshotEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STATE_SNAPSHOT>;
    snapshot: z.ZodAny;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STATE_SNAPSHOT;
    timestamp?: number | undefined;
    rawEvent?: any;
    snapshot?: any;
}, {
    type: EventType.STATE_SNAPSHOT;
    timestamp?: number | undefined;
    rawEvent?: any;
    snapshot?: any;
}>;
declare const StateDeltaEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STATE_DELTA>;
    delta: z.ZodArray<z.ZodAny, "many">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STATE_DELTA;
    delta: any[];
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STATE_DELTA;
    delta: any[];
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const MessagesSnapshotEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.MESSAGES_SNAPSHOT>;
    messages: z.ZodArray<z.ZodDiscriminatedUnion<"role", [z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"developer">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"system">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"assistant">;
        content: z.ZodOptional<z.ZodString>;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"function">;
            function: z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }>, "many">>;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"user">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        role: z.ZodLiteral<"tool">;
        toolCallId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }>]>, "many">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.MESSAGES_SNAPSHOT;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.MESSAGES_SNAPSHOT;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RawEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RAW>;
    event: z.ZodAny;
    source: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RAW;
    timestamp?: number | undefined;
    rawEvent?: any;
    event?: any;
    source?: string | undefined;
}, {
    type: EventType.RAW;
    timestamp?: number | undefined;
    rawEvent?: any;
    event?: any;
    source?: string | undefined;
}>;
declare const CustomEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.CUSTOM>;
    name: z.ZodString;
    value: z.ZodAny;
}>, "strip", z.ZodTypeAny, {
    name: string;
    type: EventType.CUSTOM;
    value?: any;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    name: string;
    type: EventType.CUSTOM;
    value?: any;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunStartedEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_STARTED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunFinishedEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_FINISHED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const RunErrorEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_ERROR>;
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const StepStartedEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_STARTED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const StepFinishedEventSchema: z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_FINISHED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>;
declare const EventSchemas: z.ZodDiscriminatedUnion<"type", [z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_START>;
    messageId: z.ZodString;
    role: z.ZodLiteral<"assistant">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_START;
    role: "assistant";
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_START;
    role: "assistant";
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_CONTENT>;
    messageId: z.ZodString;
    delta: z.ZodEffects<z.ZodString, string, string>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_CONTENT;
    messageId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_CONTENT;
    messageId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_END>;
    messageId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_END;
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TEXT_MESSAGE_END;
    messageId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TEXT_MESSAGE_CHUNK>;
    messageId: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodLiteral<"assistant">>;
    delta: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TEXT_MESSAGE_CHUNK;
    role?: "assistant" | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    messageId?: string | undefined;
    delta?: string | undefined;
}, {
    type: EventType.TEXT_MESSAGE_CHUNK;
    role?: "assistant" | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    messageId?: string | undefined;
    delta?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_START>;
    toolCallId: z.ZodString;
    toolCallName: z.ZodString;
    parentMessageId: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_START;
    toolCallId: string;
    toolCallName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
    parentMessageId?: string | undefined;
}, {
    type: EventType.TOOL_CALL_START;
    toolCallId: string;
    toolCallName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
    parentMessageId?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_ARGS>;
    toolCallId: z.ZodString;
    delta: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_ARGS;
    toolCallId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TOOL_CALL_ARGS;
    toolCallId: string;
    delta: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_END>;
    toolCallId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_END;
    toolCallId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.TOOL_CALL_END;
    toolCallId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.TOOL_CALL_CHUNK>;
    toolCallId: z.ZodOptional<z.ZodString>;
    toolCallName: z.ZodOptional<z.ZodString>;
    parentMessageId: z.ZodOptional<z.ZodString>;
    delta: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.TOOL_CALL_CHUNK;
    toolCallId?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    delta?: string | undefined;
    toolCallName?: string | undefined;
    parentMessageId?: string | undefined;
}, {
    type: EventType.TOOL_CALL_CHUNK;
    toolCallId?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
    delta?: string | undefined;
    toolCallName?: string | undefined;
    parentMessageId?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STATE_SNAPSHOT>;
    snapshot: z.ZodAny;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STATE_SNAPSHOT;
    timestamp?: number | undefined;
    rawEvent?: any;
    snapshot?: any;
}, {
    type: EventType.STATE_SNAPSHOT;
    timestamp?: number | undefined;
    rawEvent?: any;
    snapshot?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STATE_DELTA>;
    delta: z.ZodArray<z.ZodAny, "many">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STATE_DELTA;
    delta: any[];
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STATE_DELTA;
    delta: any[];
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.MESSAGES_SNAPSHOT>;
    messages: z.ZodArray<z.ZodDiscriminatedUnion<"role", [z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"developer">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"system">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"assistant">;
        content: z.ZodOptional<z.ZodString>;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"function">;
            function: z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }>, "many">>;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }, {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        id: z.ZodString;
        role: z.ZodString;
        content: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, {
        role: z.ZodLiteral<"user">;
        content: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }, {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        role: z.ZodLiteral<"tool">;
        toolCallId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }, {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    }>]>, "many">;
}>, "strip", z.ZodTypeAny, {
    type: EventType.MESSAGES_SNAPSHOT;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.MESSAGES_SNAPSHOT;
    messages: ({
        id: string;
        role: "developer";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "system";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "assistant";
        name?: string | undefined;
        content?: string | undefined;
        toolCalls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
    } | {
        id: string;
        role: "user";
        content: string;
        name?: string | undefined;
    } | {
        id: string;
        role: "tool";
        content: string;
        toolCallId: string;
    })[];
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RAW>;
    event: z.ZodAny;
    source: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RAW;
    timestamp?: number | undefined;
    rawEvent?: any;
    event?: any;
    source?: string | undefined;
}, {
    type: EventType.RAW;
    timestamp?: number | undefined;
    rawEvent?: any;
    event?: any;
    source?: string | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.CUSTOM>;
    name: z.ZodString;
    value: z.ZodAny;
}>, "strip", z.ZodTypeAny, {
    name: string;
    type: EventType.CUSTOM;
    value?: any;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    name: string;
    type: EventType.CUSTOM;
    value?: any;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_STARTED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_STARTED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_FINISHED>;
    threadId: z.ZodString;
    runId: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.RUN_FINISHED;
    threadId: string;
    runId: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.RUN_ERROR>;
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}>, "strip", z.ZodTypeAny, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    message: string;
    type: EventType.RUN_ERROR;
    code?: string | undefined;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_STARTED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_STARTED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>, z.ZodObject<z.objectUtil.extendShape<{
    type: z.ZodNativeEnum<typeof EventType>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    rawEvent: z.ZodOptional<z.ZodAny>;
}, {
    type: z.ZodLiteral<EventType.STEP_FINISHED>;
    stepName: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}, {
    type: EventType.STEP_FINISHED;
    stepName: string;
    timestamp?: number | undefined;
    rawEvent?: any;
}>]>;
type BaseEvent = z.infer<typeof BaseEventSchema>;
type TextMessageStartEvent = z.infer<typeof TextMessageStartEventSchema>;
type TextMessageContentEvent = z.infer<typeof TextMessageContentEventSchema>;
type TextMessageEndEvent = z.infer<typeof TextMessageEndEventSchema>;
type TextMessageChunkEvent = z.infer<typeof TextMessageChunkEventSchema>;
type ToolCallStartEvent = z.infer<typeof ToolCallStartEventSchema>;
type ToolCallArgsEvent = z.infer<typeof ToolCallArgsEventSchema>;
type ToolCallEndEvent = z.infer<typeof ToolCallEndEventSchema>;
type ToolCallChunkEvent = z.infer<typeof ToolCallChunkEventSchema>;
type StateSnapshotEvent = z.infer<typeof StateSnapshotEventSchema>;
type StateDeltaEvent = z.infer<typeof StateDeltaEventSchema>;
type MessagesSnapshotEvent = z.infer<typeof MessagesSnapshotEventSchema>;
type RawEvent = z.infer<typeof RawEventSchema>;
type CustomEvent = z.infer<typeof CustomEventSchema>;
type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
type RunFinishedEvent = z.infer<typeof RunFinishedEventSchema>;
type RunErrorEvent = z.infer<typeof RunErrorEventSchema>;
type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;
type StepFinishedEvent = z.infer<typeof StepFinishedEventSchema>;

/**
 * Function type for agent runners that process input and return a stream of results.
 */
type RunAgent = (input: RunAgentInput) => Observable<BaseEvent>;
/**
 * The transformed state of an agent.
 */
interface AgentState {
    messages?: Message[];
    state?: State;
}
/**
 * Maps a stream of BaseEvent objects to a stream of AgentState objects.
 * @returns A function that transforms an Observable<BaseEvent> into an Observable<TransformedState>
 */
type ApplyEvents = (input: RunAgentInput, events$: Observable<BaseEvent>) => Observable<AgentState>;

export { AGUIError, type AgentState, type ApplyEvents, type AssistantMessage, AssistantMessageSchema, type BaseEvent, BaseMessageSchema, type Context, ContextSchema, type CustomEvent, CustomEventSchema, type DeveloperMessage, DeveloperMessageSchema, EventSchemas, EventType, type FunctionCall, FunctionCallSchema, type Message, MessageSchema, type MessagesSnapshotEvent, MessagesSnapshotEventSchema, type RawEvent, RawEventSchema, type Role, RoleSchema, type RunAgent, type RunAgentInput, RunAgentInputSchema, type RunErrorEvent, RunErrorEventSchema, RunErrorSchema, type RunFinishedEvent, RunFinishedEventSchema, RunFinishedSchema, type RunStartedEvent, RunStartedEventSchema, RunStartedSchema, type State, type StateDeltaEvent, StateDeltaEventSchema, StateSchema, type StateSnapshotEvent, StateSnapshotEventSchema, type StepFinishedEvent, StepFinishedEventSchema, StepFinishedSchema, type StepStartedEvent, StepStartedEventSchema, StepStartedSchema, type SystemMessage, SystemMessageSchema, type TextMessageChunkEvent, TextMessageChunkEventSchema, type TextMessageContentEvent, TextMessageContentEventSchema, type TextMessageEndEvent, TextMessageEndEventSchema, type TextMessageStartEvent, TextMessageStartEventSchema, type Tool, type ToolCall, type ToolCallArgsEvent, ToolCallArgsEventSchema, type ToolCallChunkEvent, ToolCallChunkEventSchema, type ToolCallEndEvent, ToolCallEndEventSchema, ToolCallSchema, type ToolCallStartEvent, ToolCallStartEventSchema, type ToolMessage, ToolMessageSchema, ToolSchema, type UserMessage, UserMessageSchema };
