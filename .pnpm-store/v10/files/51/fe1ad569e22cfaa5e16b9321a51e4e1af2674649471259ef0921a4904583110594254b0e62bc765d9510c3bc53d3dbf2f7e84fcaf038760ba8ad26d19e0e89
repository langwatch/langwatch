import { z } from 'zod';
import { Agent } from './agent';
import { RunItem, RunToolApprovalItem } from './items';
import type { ModelResponse } from './model';
import { RunContext } from './runContext';
import { AgentToolUseTracker } from './runner/toolUseTracker';
import { NextStep } from './runner/steps';
import type { ProcessedResponse } from './runner/types';
import type { AgentSpanData, Span } from './tracing/spans';
import { Usage } from './usage';
import { Trace } from './tracing/traces';
import { AgentInputItem } from './types';
import type { InputGuardrailResult, OutputGuardrailResult } from './guardrail';
import type { ToolInputGuardrailResult, ToolOutputGuardrailResult } from './toolGuardrail';
/**
 * The schema version of the serialized run state. This is used to ensure that the serialized
 * run state is compatible with the current version of the SDK.
 * If anything in this schema changes, the version will have to be incremented.
 *
 * Version history.
 * - 1.0: Initial serialized RunState schema.
 * - 1.1: Adds optional currentTurnInProgress, conversationId, and previousResponseId fields,
 *   plus broader tool_call_output_item rawItem variants for non-function tools. Older 1.0
 *   payloads remain readable but resumes may lack mid-turn or server-managed context precision.
 */
export declare const CURRENT_SCHEMA_VERSION: "1.1";
declare const serializedSpanBase: z.ZodObject<{
    object: z.ZodLiteral<"trace.span">;
    id: z.ZodString;
    trace_id: z.ZodString;
    parent_id: z.ZodNullable<z.ZodString>;
    started_at: z.ZodNullable<z.ZodString>;
    ended_at: z.ZodNullable<z.ZodString>;
    error: z.ZodNullable<z.ZodObject<{
        message: z.ZodString;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        data?: Record<string, any> | undefined;
    }, {
        message: string;
        data?: Record<string, any> | undefined;
    }>>;
    span_data: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    object: "trace.span";
    id: string;
    trace_id: string;
    parent_id: string | null;
    started_at: string | null;
    ended_at: string | null;
    span_data: Record<string, any>;
    error: {
        message: string;
        data?: Record<string, any> | undefined;
    } | null;
}, {
    object: "trace.span";
    id: string;
    trace_id: string;
    parent_id: string | null;
    started_at: string | null;
    ended_at: string | null;
    span_data: Record<string, any>;
    error: {
        message: string;
        data?: Record<string, any> | undefined;
    } | null;
}>;
type SerializedSpanType = z.infer<typeof serializedSpanBase> & {
    previous_span?: SerializedSpanType;
};
export declare const SerializedRunState: z.ZodObject<{
    $schemaVersion: z.ZodEnum<["1.0", "1.1"]>;
    currentTurn: z.ZodNumber;
    currentAgent: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
    originalInput: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodOptional<z.ZodLiteral<"message">>;
    } & {
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<[z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_image">;
            image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>>;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        }, {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_file">;
            file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>, z.ZodObject<{
                url: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                url: string;
            }, {
                url: string;
            }>]>>;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        }, {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"audio">;
            audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>;
            format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        }, {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        }>]>, "many">, z.ZodString]>;
    }, "strip", z.ZodTypeAny, {
        role: "user";
        content: string | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        role: "user";
        content: string | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodOptional<z.ZodLiteral<"message">>;
    } & {
        role: z.ZodLiteral<"assistant">;
        status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"output_text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"refusal">;
            refusal: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"audio">;
            audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>;
            format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        }, {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"image">;
            image: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        }>]>, "many">;
    }, "strip", z.ZodTypeAny, {
        status: "in_progress" | "completed" | "incomplete";
        role: "assistant";
        content: ({
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        } | {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        status: "in_progress" | "completed" | "incomplete";
        role: "assistant";
        content: ({
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        } | {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodOptional<z.ZodLiteral<"message">>;
    } & {
        role: z.ZodLiteral<"system">;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        role: "system";
        content: string;
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        role: "system";
        content: string;
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"hosted_tool_call">;
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        output: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "hosted_tool_call";
        name: string;
        status?: string | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        arguments?: string | undefined;
        output?: string | undefined;
    }, {
        type: "hosted_tool_call";
        name: string;
        status?: string | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        arguments?: string | undefined;
        output?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"function_call">;
        callId: z.ZodString;
        name: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
        arguments: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "function_call";
        name: string;
        arguments: string;
        callId: string;
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "function_call";
        name: string;
        arguments: string;
        callId: string;
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"computer_call">;
        callId: z.ZodString;
        status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
        action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"screenshot">;
        }, "strip", z.ZodTypeAny, {
            type: "screenshot";
        }, {
            type: "screenshot";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"click">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
        }, "strip", z.ZodTypeAny, {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        }, {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"double_click">;
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "double_click";
            x: number;
            y: number;
        }, {
            type: "double_click";
            x: number;
            y: number;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"scroll">;
            x: z.ZodNumber;
            y: z.ZodNumber;
            scroll_x: z.ZodNumber;
            scroll_y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        }, {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"type">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "type";
            text: string;
        }, {
            type: "type";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"wait">;
        }, "strip", z.ZodTypeAny, {
            type: "wait";
        }, {
            type: "wait";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"move">;
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: "move";
            x: number;
            y: number;
        }, {
            type: "move";
            x: number;
            y: number;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"keypress">;
            keys: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            keys: string[];
            type: "keypress";
        }, {
            keys: string[];
            type: "keypress";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"drag">;
            path: z.ZodArray<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                x: number;
                y: number;
            }, {
                x: number;
                y: number;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        }, {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "computer_call";
        status: "in_progress" | "completed" | "incomplete";
        callId: string;
        action: {
            type: "screenshot";
        } | {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        } | {
            type: "double_click";
            x: number;
            y: number;
        } | {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        } | {
            type: "type";
            text: string;
        } | {
            type: "wait";
        } | {
            type: "move";
            x: number;
            y: number;
        } | {
            keys: string[];
            type: "keypress";
        } | {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "computer_call";
        status: "in_progress" | "completed" | "incomplete";
        callId: string;
        action: {
            type: "screenshot";
        } | {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        } | {
            type: "double_click";
            x: number;
            y: number;
        } | {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        } | {
            type: "type";
            text: string;
        } | {
            type: "wait";
        } | {
            type: "move";
            x: number;
            y: number;
        } | {
            keys: string[];
            type: "keypress";
        } | {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"shell_call">;
        callId: z.ZodString;
        status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
        action: z.ZodObject<{
            commands: z.ZodArray<z.ZodString, "many">;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        }, {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "shell_call";
        callId: string;
        action: {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        };
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "shell_call";
        callId: string;
        action: {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        };
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"apply_patch_call">;
        callId: z.ZodString;
        status: z.ZodEnum<["in_progress", "completed"]>;
        operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"create_file">;
            path: z.ZodString;
            diff: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "create_file";
            diff: string;
        }, {
            path: string;
            type: "create_file";
            diff: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"update_file">;
            path: z.ZodString;
            diff: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "update_file";
            diff: string;
        }, {
            path: string;
            type: "update_file";
            diff: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"delete_file">;
            path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "delete_file";
        }, {
            path: string;
            type: "delete_file";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "apply_patch_call";
        status: "in_progress" | "completed";
        callId: string;
        operation: {
            path: string;
            type: "create_file";
            diff: string;
        } | {
            path: string;
            type: "update_file";
            diff: string;
        } | {
            path: string;
            type: "delete_file";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "apply_patch_call";
        status: "in_progress" | "completed";
        callId: string;
        operation: {
            path: string;
            type: "create_file";
            diff: string;
        } | {
            path: string;
            type: "update_file";
            diff: string;
        } | {
            path: string;
            type: "delete_file";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"function_call_result">;
        name: z.ZodString;
        callId: z.ZodString;
        status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
        output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"image">;
            image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                mediaType: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            }, {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            }>, z.ZodObject<{
                url: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                url: string;
            }, {
                url: string;
            }>, z.ZodObject<{
                fileId: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                fileId: string;
            }, {
                fileId: string;
            }>]>]>>;
            detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        }, {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"file">;
            file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                mediaType: z.ZodString;
                filename: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            }, {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            }>, z.ZodObject<{
                url: z.ZodString;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                url: string;
                filename?: string | undefined;
            }, {
                url: string;
                filename?: string | undefined;
            }>, z.ZodObject<{
                id: z.ZodString;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                id: string;
                filename?: string | undefined;
            }, {
                id: string;
                filename?: string | undefined;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        }, {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_image">;
            image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>>;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        }, {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_file">;
            file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                id: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                id: string;
            }, {
                id: string;
            }>]>, z.ZodObject<{
                url: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                url: string;
            }, {
                url: string;
            }>]>>;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        }, {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        }>]>, "many">]>;
    }, "strip", z.ZodTypeAny, {
        type: "function_call_result";
        status: "in_progress" | "completed" | "incomplete";
        name: string;
        output: string | {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        } | {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        } | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        })[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "function_call_result";
        status: "in_progress" | "completed" | "incomplete";
        name: string;
        output: string | {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        } | {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        } | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        })[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"computer_call_result">;
        callId: z.ZodString;
        output: z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"computer_screenshot">;
            data: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "computer_call_result";
        output: {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        };
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "computer_call_result";
        output: {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        };
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"shell_call_output">;
        callId: z.ZodString;
        maxOutputLength: z.ZodOptional<z.ZodNumber>;
        output: z.ZodArray<z.ZodObject<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "shell_call_output";
        output: z.objectOutputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        maxOutputLength?: number | undefined;
    }, {
        type: "shell_call_output";
        output: z.objectInputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        maxOutputLength?: number | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"apply_patch_call_output">;
        callId: z.ZodString;
        status: z.ZodEnum<["completed", "failed"]>;
        output: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "apply_patch_call_output";
        status: "completed" | "failed";
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        output?: string | undefined;
    }, {
        type: "apply_patch_call_output";
        status: "completed" | "failed";
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        output?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"reasoning">;
        content: z.ZodArray<z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"input_text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, "many">;
        rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"reasoning_text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }, {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "reasoning";
        content: {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[];
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        rawContent?: {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[] | undefined;
    }, {
        type: "reasoning";
        content: {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[];
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        rawContent?: {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[] | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"compaction">;
        encrypted_content: z.ZodString;
        id: z.ZodOptional<z.ZodString>;
        created_by: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "compaction";
        encrypted_content: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        created_by?: string | undefined;
    }, {
        type: "compaction";
        encrypted_content: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        created_by?: string | undefined;
    }>, z.ZodObject<{
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        id: z.ZodOptional<z.ZodString>;
    } & {
        type: z.ZodLiteral<"unknown">;
    }, "strip", z.ZodTypeAny, {
        type: "unknown";
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }, {
        type: "unknown";
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    }>]>, "many">]>;
    modelResponses: z.ZodArray<z.ZodObject<{
        usage: z.ZodObject<{
            requests: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            inputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            outputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                endpoint: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }>;
        output: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodOptional<z.ZodLiteral<"message">>;
        } & {
            role: z.ZodLiteral<"assistant">;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"output_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"refusal">;
                refusal: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"audio">;
                audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>;
                format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }>]>, "many">;
        }, "strip", z.ZodTypeAny, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            name: z.ZodString;
            arguments: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            callId: z.ZodString;
            name: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"screenshot">;
            }, "strip", z.ZodTypeAny, {
                type: "screenshot";
            }, {
                type: "screenshot";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
            }, "strip", z.ZodTypeAny, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
            }, {
                type: "double_click";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                scroll_x: z.ZodNumber;
                scroll_y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"type">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "type";
                text: string;
            }, {
                type: "type";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
            }, "strip", z.ZodTypeAny, {
                type: "wait";
            }, {
                type: "wait";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "move";
                x: number;
                y: number;
            }, {
                type: "move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"keypress">;
                keys: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                keys: string[];
                type: "keypress";
            }, {
                keys: string[];
                type: "keypress";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                path: z.ZodArray<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                }, {
                    x: number;
                    y: number;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            name: z.ZodString;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call_output">;
            callId: z.ZodString;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
            output: z.ZodArray<z.ZodObject<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">>, "many">;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }, {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call_output">;
            callId: z.ZodString;
            status: z.ZodEnum<["completed", "failed"]>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
            content: z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">;
            rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"reasoning_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"compaction">;
            encrypted_content: z.ZodString;
            id: z.ZodOptional<z.ZodString>;
            created_by: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"unknown">;
        }, "strip", z.ZodTypeAny, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, "many">;
        responseId: z.ZodOptional<z.ZodString>;
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }, {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }>, "many">;
    context: z.ZodObject<{
        usage: z.ZodObject<{
            requests: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            inputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            outputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                endpoint: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }>;
        approvals: z.ZodRecord<z.ZodString, z.ZodObject<{
            approved: z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodBoolean]>;
            rejected: z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodBoolean]>;
        }, "strip", z.ZodTypeAny, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }>>;
        context: z.ZodRecord<z.ZodString, z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        context: Record<string, any>;
        approvals: Record<string, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }>;
    }, {
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        context: Record<string, any>;
        approvals: Record<string, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }>;
    }>;
    toolUseTracker: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
    maxTurns: z.ZodNumber;
    currentAgentSpan: z.ZodOptional<z.ZodNullable<z.ZodType<SerializedSpanType, z.ZodTypeDef, SerializedSpanType>>>;
    noActiveAgentRun: z.ZodBoolean;
    inputGuardrailResults: z.ZodArray<z.ZodObject<{
        guardrail: z.ZodObject<{
            type: z.ZodLiteral<"input">;
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "input";
            name: string;
        }, {
            type: "input";
            name: string;
        }>;
        output: z.ZodObject<{
            tripwireTriggered: z.ZodBoolean;
            outputInfo: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            tripwireTriggered: boolean;
            outputInfo?: any;
        }, {
            tripwireTriggered: boolean;
            outputInfo?: any;
        }>;
    }, "strip", z.ZodTypeAny, {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        guardrail: {
            type: "input";
            name: string;
        };
    }, {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        guardrail: {
            type: "input";
            name: string;
        };
    }>, "many">;
    outputGuardrailResults: z.ZodArray<z.ZodObject<{
        guardrail: z.ZodObject<{
            type: z.ZodLiteral<"output">;
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "output";
            name: string;
        }, {
            type: "output";
            name: string;
        }>;
        agentOutput: z.ZodAny;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
        output: z.ZodObject<{
            tripwireTriggered: z.ZodBoolean;
            outputInfo: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            tripwireTriggered: boolean;
            outputInfo?: any;
        }, {
            tripwireTriggered: boolean;
            outputInfo?: any;
        }>;
    }, "strip", z.ZodTypeAny, {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        agent: {
            name: string;
        };
        guardrail: {
            type: "output";
            name: string;
        };
        agentOutput?: any;
    }, {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        agent: {
            name: string;
        };
        guardrail: {
            type: "output";
            name: string;
        };
        agentOutput?: any;
    }>, "many">;
    toolInputGuardrailResults: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        guardrail: z.ZodObject<{
            name: z.ZodString;
        } & {
            type: z.ZodLiteral<"tool_input">;
        }, "strip", z.ZodTypeAny, {
            type: "tool_input";
            name: string;
        }, {
            type: "tool_input";
            name: string;
        }>;
        output: z.ZodObject<{
            outputInfo: z.ZodOptional<z.ZodAny>;
            behavior: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"allow">;
            }, "strip", z.ZodTypeAny, {
                type: "allow";
            }, {
                type: "allow";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"rejectContent">;
                message: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                message: string;
                type: "rejectContent";
            }, {
                message: string;
                type: "rejectContent";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"throwException">;
            }, "strip", z.ZodTypeAny, {
                type: "throwException";
            }, {
                type: "throwException";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        }, {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        }>;
    }, "strip", z.ZodTypeAny, {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_input";
            name: string;
        };
    }, {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_input";
            name: string;
        };
    }>, "many">>>;
    toolOutputGuardrailResults: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        guardrail: z.ZodObject<{
            name: z.ZodString;
        } & {
            type: z.ZodLiteral<"tool_output">;
        }, "strip", z.ZodTypeAny, {
            type: "tool_output";
            name: string;
        }, {
            type: "tool_output";
            name: string;
        }>;
        output: z.ZodObject<{
            outputInfo: z.ZodOptional<z.ZodAny>;
            behavior: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"allow">;
            }, "strip", z.ZodTypeAny, {
                type: "allow";
            }, {
                type: "allow";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"rejectContent">;
                message: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                message: string;
                type: "rejectContent";
            }, {
                message: string;
                type: "rejectContent";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"throwException">;
            }, "strip", z.ZodTypeAny, {
                type: "throwException";
            }, {
                type: "throwException";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        }, {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        }>;
    }, "strip", z.ZodTypeAny, {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_output";
            name: string;
        };
    }, {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_output";
            name: string;
        };
    }>, "many">>>;
    currentTurnInProgress: z.ZodOptional<z.ZodBoolean>;
    currentStep: z.ZodOptional<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"next_step_handoff">;
        newAgent: z.ZodAny;
    }, "strip", z.ZodTypeAny, {
        type: "next_step_handoff";
        newAgent?: any;
    }, {
        type: "next_step_handoff";
        newAgent?: any;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"next_step_final_output">;
        output: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "next_step_final_output";
        output: string;
    }, {
        type: "next_step_final_output";
        output: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"next_step_run_again">;
    }, "strip", z.ZodTypeAny, {
        type: "next_step_run_again";
    }, {
        type: "next_step_run_again";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"next_step_interruption">;
        data: z.ZodRecord<z.ZodString, z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        type: "next_step_interruption";
        data: Record<string, any>;
    }, {
        type: "next_step_interruption";
        data: Record<string, any>;
    }>]>>;
    lastModelResponse: z.ZodOptional<z.ZodObject<{
        usage: z.ZodObject<{
            requests: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            inputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            outputTokensDetails: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">>;
            requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                endpoint: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }>;
        output: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodOptional<z.ZodLiteral<"message">>;
        } & {
            role: z.ZodLiteral<"assistant">;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"output_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"refusal">;
                refusal: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"audio">;
                audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>;
                format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }>]>, "many">;
        }, "strip", z.ZodTypeAny, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            name: z.ZodString;
            arguments: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            callId: z.ZodString;
            name: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"screenshot">;
            }, "strip", z.ZodTypeAny, {
                type: "screenshot";
            }, {
                type: "screenshot";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
            }, "strip", z.ZodTypeAny, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
            }, {
                type: "double_click";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                scroll_x: z.ZodNumber;
                scroll_y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"type">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "type";
                text: string;
            }, {
                type: "type";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
            }, "strip", z.ZodTypeAny, {
                type: "wait";
            }, {
                type: "wait";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "move";
                x: number;
                y: number;
            }, {
                type: "move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"keypress">;
                keys: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                keys: string[];
                type: "keypress";
            }, {
                keys: string[];
                type: "keypress";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                path: z.ZodArray<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                }, {
                    x: number;
                    y: number;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            name: z.ZodString;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call_output">;
            callId: z.ZodString;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
            output: z.ZodArray<z.ZodObject<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">>, "many">;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }, {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call_output">;
            callId: z.ZodString;
            status: z.ZodEnum<["completed", "failed"]>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
            content: z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">;
            rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"reasoning_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"compaction">;
            encrypted_content: z.ZodString;
            id: z.ZodOptional<z.ZodString>;
            created_by: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"unknown">;
        }, "strip", z.ZodTypeAny, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, "many">;
        responseId: z.ZodOptional<z.ZodString>;
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }, {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }>>;
    generatedItems: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"message_output_item">;
        rawItem: z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodOptional<z.ZodLiteral<"message">>;
        } & {
            role: z.ZodLiteral<"assistant">;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"output_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"refusal">;
                refusal: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"audio">;
                audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>;
                format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }>]>, "many">;
        }, "strip", z.ZodTypeAny, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "message_output_item";
        agent: {
            name: string;
        };
        rawItem: {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }, {
        type: "message_output_item";
        agent: {
            name: string;
        };
        rawItem: {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"tool_call_item">;
        rawItem: z.ZodUnion<[z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"screenshot">;
            }, "strip", z.ZodTypeAny, {
                type: "screenshot";
            }, {
                type: "screenshot";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
            }, "strip", z.ZodTypeAny, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
            }, {
                type: "double_click";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                scroll_x: z.ZodNumber;
                scroll_y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"type">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "type";
                text: string;
            }, {
                type: "type";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
            }, "strip", z.ZodTypeAny, {
                type: "wait";
            }, {
                type: "wait";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "move";
                x: number;
                y: number;
            }, {
                type: "move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"keypress">;
                keys: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                keys: string[];
                type: "keypress";
            }, {
                keys: string[];
                type: "keypress";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                path: z.ZodArray<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                }, {
                    x: number;
                    y: number;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            callId: z.ZodString;
            name: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            name: z.ZodString;
            arguments: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>]>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            name: z.ZodString;
            arguments: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>]>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "tool_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }, {
        type: "tool_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"tool_call_output_item">;
        rawItem: z.ZodUnion<[z.ZodUnion<[z.ZodUnion<[z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            name: z.ZodString;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call_result">;
            callId: z.ZodString;
            output: z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"computer_screenshot">;
                data: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call_output">;
            callId: z.ZodString;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
            output: z.ZodArray<z.ZodObject<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">>, "many">;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }, {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }>]>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call_output">;
            callId: z.ZodString;
            status: z.ZodEnum<["completed", "failed"]>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }>]>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
        output: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "tool_call_output_item";
        output: string;
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        };
    }, {
        type: "tool_call_output_item";
        output: string;
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"reasoning_item">;
        rawItem: z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
            content: z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">;
            rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"reasoning_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "reasoning_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        };
    }, {
        type: "reasoning_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"handoff_call_item">;
        rawItem: z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            callId: z.ZodString;
            name: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "handoff_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }, {
        type: "handoff_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"handoff_output_item">;
        rawItem: z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            name: z.ZodString;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>;
        sourceAgent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
        targetAgent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "handoff_output_item";
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        sourceAgent: {
            name: string;
        };
        targetAgent: {
            name: string;
        };
    }, {
        type: "handoff_output_item";
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        sourceAgent: {
            name: string;
        };
        targetAgent: {
            name: string;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"tool_approval_item">;
        rawItem: z.ZodUnion<[z.ZodUnion<[z.ZodUnion<[z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            callId: z.ZodString;
            name: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            name: z.ZodString;
            arguments: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>]>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>;
        agent: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
        toolName: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "tool_approval_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        toolName?: string | undefined;
    }, {
        type: "tool_approval_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        toolName?: string | undefined;
    }>]>, "many">;
    lastProcessedResponse: z.ZodOptional<z.ZodObject<{
        newItems: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"message_output_item">;
            rawItem: z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodOptional<z.ZodLiteral<"message">>;
            } & {
                role: z.ZodLiteral<"assistant">;
                status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
                content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"output_text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"refusal">;
                    refusal: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"audio">;
                    audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                        id: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                    }, {
                        id: string;
                    }>]>;
                    format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                }, "strip", z.ZodTypeAny, {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                }, {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"image">;
                    image: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                }>]>, "many">;
            }, "strip", z.ZodTypeAny, {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }, {
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"tool_call_item">;
            rawItem: z.ZodUnion<[z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"computer_call">;
                callId: z.ZodString;
                status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
                action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"screenshot">;
                }, "strip", z.ZodTypeAny, {
                    type: "screenshot";
                }, {
                    type: "screenshot";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
                }, "strip", z.ZodTypeAny, {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                }, {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"double_click">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    type: "double_click";
                    x: number;
                    y: number;
                }, {
                    type: "double_click";
                    x: number;
                    y: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"scroll">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    scroll_x: z.ZodNumber;
                    scroll_y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                }, {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"type">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "type";
                    text: string;
                }, {
                    type: "type";
                    text: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"wait">;
                }, "strip", z.ZodTypeAny, {
                    type: "wait";
                }, {
                    type: "wait";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"move">;
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    type: "move";
                    x: number;
                    y: number;
                }, {
                    type: "move";
                    x: number;
                    y: number;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"keypress">;
                    keys: z.ZodArray<z.ZodString, "many">;
                }, "strip", z.ZodTypeAny, {
                    keys: string[];
                    type: "keypress";
                }, {
                    keys: string[];
                    type: "keypress";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"drag">;
                    path: z.ZodArray<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        x: number;
                        y: number;
                    }, {
                        x: number;
                        y: number;
                    }>, "many">;
                }, "strip", z.ZodTypeAny, {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                }, {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"shell_call">;
                callId: z.ZodString;
                status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
                action: z.ZodObject<{
                    commands: z.ZodArray<z.ZodString, "many">;
                    timeoutMs: z.ZodOptional<z.ZodNumber>;
                    maxOutputLength: z.ZodOptional<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                }, {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"apply_patch_call">;
                callId: z.ZodString;
                status: z.ZodEnum<["in_progress", "completed"]>;
                operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"create_file">;
                    path: z.ZodString;
                    diff: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "create_file";
                    diff: string;
                }, {
                    path: string;
                    type: "create_file";
                    diff: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"update_file">;
                    path: z.ZodString;
                    diff: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "update_file";
                    diff: string;
                }, {
                    path: string;
                    type: "update_file";
                    diff: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"delete_file">;
                    path: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "delete_file";
                }, {
                    path: string;
                    type: "delete_file";
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"function_call">;
                callId: z.ZodString;
                name: z.ZodString;
                status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"hosted_tool_call">;
                name: z.ZodString;
                arguments: z.ZodOptional<z.ZodString>;
                status: z.ZodOptional<z.ZodString>;
                output: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }>]>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"hosted_tool_call">;
                name: z.ZodString;
                arguments: z.ZodOptional<z.ZodString>;
                status: z.ZodOptional<z.ZodString>;
                output: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }>]>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }, {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"tool_call_output_item">;
            rawItem: z.ZodUnion<[z.ZodUnion<[z.ZodUnion<[z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"function_call_result">;
                name: z.ZodString;
                callId: z.ZodString;
                status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
                output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"image">;
                    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                        mediaType: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    }, {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    }>, z.ZodObject<{
                        url: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                    }, {
                        url: string;
                    }>, z.ZodObject<{
                        fileId: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        fileId: string;
                    }, {
                        fileId: string;
                    }>]>]>>;
                    detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
                }, "strip", z.ZodTypeAny, {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                }, {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"file">;
                    file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                        mediaType: z.ZodString;
                        filename: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    }, {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    }>, z.ZodObject<{
                        url: z.ZodString;
                        filename: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                        filename?: string | undefined;
                    }, {
                        url: string;
                        filename?: string | undefined;
                    }>, z.ZodObject<{
                        id: z.ZodString;
                        filename: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        filename?: string | undefined;
                    }, {
                        id: string;
                        filename?: string | undefined;
                    }>]>;
                }, "strip", z.ZodTypeAny, {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_image">;
                    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                        id: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                    }, {
                        id: string;
                    }>]>>;
                    detail: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                }, {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_file">;
                    file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                        id: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                    }, {
                        id: string;
                    }>]>, z.ZodObject<{
                        url: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                    }, {
                        url: string;
                    }>]>>;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                }, {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                }>]>, "many">]>;
            }, "strip", z.ZodTypeAny, {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"computer_call_result">;
                callId: z.ZodString;
                output: z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"computer_screenshot">;
                    data: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>]>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"shell_call_output">;
                callId: z.ZodString;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
                output: z.ZodArray<z.ZodObject<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">>, "many">;
            }, "strip", z.ZodTypeAny, {
                type: "shell_call_output";
                output: z.objectOutputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            }, {
                type: "shell_call_output";
                output: z.objectInputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            }>]>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"apply_patch_call_output">;
                callId: z.ZodString;
                status: z.ZodEnum<["completed", "failed"]>;
                output: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            }, {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            }>]>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
            output: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectOutputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        }, {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectInputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"reasoning_item">;
            rawItem: z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
                type: z.ZodLiteral<"reasoning">;
                content: z.ZodArray<z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, "many">;
                rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"reasoning_text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, "many">>;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            }, {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            }>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        }, {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"handoff_call_item">;
            rawItem: z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"function_call">;
                callId: z.ZodString;
                name: z.ZodString;
                status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }, {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"handoff_output_item">;
            rawItem: z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"function_call_result">;
                name: z.ZodString;
                callId: z.ZodString;
                status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
                output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"image">;
                    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                        mediaType: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    }, {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    }>, z.ZodObject<{
                        url: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                    }, {
                        url: string;
                    }>, z.ZodObject<{
                        fileId: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        fileId: string;
                    }, {
                        fileId: string;
                    }>]>]>>;
                    detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
                }, "strip", z.ZodTypeAny, {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                }, {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"file">;
                    file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                        mediaType: z.ZodString;
                        filename: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    }, {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    }>, z.ZodObject<{
                        url: z.ZodString;
                        filename: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                        filename?: string | undefined;
                    }, {
                        url: string;
                        filename?: string | undefined;
                    }>, z.ZodObject<{
                        id: z.ZodString;
                        filename: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        filename?: string | undefined;
                    }, {
                        id: string;
                        filename?: string | undefined;
                    }>]>;
                }, "strip", z.ZodTypeAny, {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_text">;
                    text: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }, {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_image">;
                    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                        id: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                    }, {
                        id: string;
                    }>]>>;
                    detail: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                }, {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                }>, z.ZodObject<{
                    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                } & {
                    type: z.ZodLiteral<"input_file">;
                    file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                        id: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                    }, {
                        id: string;
                    }>]>, z.ZodObject<{
                        url: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        url: string;
                    }, {
                        url: string;
                    }>]>>;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                }, {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                }>]>, "many">]>;
            }, "strip", z.ZodTypeAny, {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>;
            sourceAgent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
            targetAgent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        }, {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"tool_approval_item">;
            rawItem: z.ZodUnion<[z.ZodUnion<[z.ZodUnion<[z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"function_call">;
                callId: z.ZodString;
                name: z.ZodString;
                status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"hosted_tool_call">;
                name: z.ZodString;
                arguments: z.ZodOptional<z.ZodString>;
                status: z.ZodOptional<z.ZodString>;
                output: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }, {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            }>]>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"shell_call">;
                callId: z.ZodString;
                status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
                action: z.ZodObject<{
                    commands: z.ZodArray<z.ZodString, "many">;
                    timeoutMs: z.ZodOptional<z.ZodNumber>;
                    maxOutputLength: z.ZodOptional<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                }, {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>]>, z.ZodObject<{
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                id: z.ZodOptional<z.ZodString>;
            } & {
                type: z.ZodLiteral<"apply_patch_call">;
                callId: z.ZodString;
                status: z.ZodEnum<["in_progress", "completed"]>;
                operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"create_file">;
                    path: z.ZodString;
                    diff: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "create_file";
                    diff: string;
                }, {
                    path: string;
                    type: "create_file";
                    diff: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"update_file">;
                    path: z.ZodString;
                    diff: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "update_file";
                    diff: string;
                }, {
                    path: string;
                    type: "update_file";
                    diff: string;
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"delete_file">;
                    path: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    path: string;
                    type: "delete_file";
                }, {
                    path: string;
                    type: "delete_file";
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }, {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            }>]>;
            agent: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
            toolName: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        }, {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        }>]>, "many">;
        toolsUsed: z.ZodArray<z.ZodString, "many">;
        handoffs: z.ZodArray<z.ZodObject<{
            toolCall: z.ZodAny;
            handoff: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            handoff?: any;
            toolCall?: any;
        }, {
            handoff?: any;
            toolCall?: any;
        }>, "many">;
        functions: z.ZodArray<z.ZodObject<{
            toolCall: z.ZodAny;
            tool: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            toolCall?: any;
            tool?: any;
        }, {
            toolCall?: any;
            tool?: any;
        }>, "many">;
        computerActions: z.ZodArray<z.ZodObject<{
            toolCall: z.ZodAny;
            computer: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            computer?: any;
            toolCall?: any;
        }, {
            computer?: any;
            toolCall?: any;
        }>, "many">;
        shellActions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            toolCall: z.ZodAny;
            shell: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            shell?: any;
            toolCall?: any;
        }, {
            shell?: any;
            toolCall?: any;
        }>, "many">>;
        applyPatchActions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            toolCall: z.ZodAny;
            applyPatch: z.ZodAny;
        }, "strip", z.ZodTypeAny, {
            toolCall?: any;
            applyPatch?: any;
        }, {
            toolCall?: any;
            applyPatch?: any;
        }>, "many">>;
        mcpApprovalRequests: z.ZodOptional<z.ZodArray<z.ZodObject<{
            requestItem: z.ZodObject<{
                rawItem: z.ZodObject<{
                    type: z.ZodLiteral<"hosted_tool_call">;
                    name: z.ZodString;
                    arguments: z.ZodOptional<z.ZodString>;
                    status: z.ZodOptional<z.ZodString>;
                    output: z.ZodOptional<z.ZodString>;
                    providerData: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>>;
                }, "strip", z.ZodTypeAny, {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                }, {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            }, {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            }>;
            mcpTool: z.ZodObject<{
                type: z.ZodLiteral<"hosted_tool">;
                name: z.ZodLiteral<"hosted_mcp">;
                providerData: z.ZodRecord<z.ZodString, z.ZodAny>;
            }, "strip", z.ZodTypeAny, {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            }, {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            }>;
        }, "strip", z.ZodTypeAny, {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }, {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        handoffs: {
            handoff?: any;
            toolCall?: any;
        }[];
        newItems: ({
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectOutputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        } | {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        } | {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        } | {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        })[];
        toolsUsed: string[];
        functions: {
            toolCall?: any;
            tool?: any;
        }[];
        computerActions: {
            computer?: any;
            toolCall?: any;
        }[];
        shellActions?: {
            shell?: any;
            toolCall?: any;
        }[] | undefined;
        applyPatchActions?: {
            toolCall?: any;
            applyPatch?: any;
        }[] | undefined;
        mcpApprovalRequests?: {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }[] | undefined;
    }, {
        handoffs: {
            handoff?: any;
            toolCall?: any;
        }[];
        newItems: ({
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectInputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        } | {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        } | {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        } | {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        })[];
        toolsUsed: string[];
        functions: {
            toolCall?: any;
            tool?: any;
        }[];
        computerActions: {
            computer?: any;
            toolCall?: any;
        }[];
        shellActions?: {
            shell?: any;
            toolCall?: any;
        }[] | undefined;
        applyPatchActions?: {
            toolCall?: any;
            applyPatch?: any;
        }[] | undefined;
        mcpApprovalRequests?: {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }[] | undefined;
    }>>;
    currentTurnPersistedItemCount: z.ZodOptional<z.ZodNumber>;
    conversationId: z.ZodOptional<z.ZodString>;
    previousResponseId: z.ZodOptional<z.ZodString>;
    trace: z.ZodNullable<z.ZodObject<{
        object: z.ZodLiteral<"trace">;
        id: z.ZodString;
        workflow_name: z.ZodString;
        group_id: z.ZodNullable<z.ZodString>;
        metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
        tracing_api_key: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        object: "trace";
        id: string;
        workflow_name: string;
        group_id: string | null;
        metadata: Record<string, any>;
        tracing_api_key?: string | null | undefined;
    }, {
        object: "trace";
        id: string;
        workflow_name: string;
        group_id: string | null;
        metadata: Record<string, any>;
        tracing_api_key?: string | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    trace: {
        object: "trace";
        id: string;
        workflow_name: string;
        group_id: string | null;
        metadata: Record<string, any>;
        tracing_api_key?: string | null | undefined;
    } | null;
    $schemaVersion: "1.0" | "1.1";
    currentTurn: number;
    currentAgent: {
        name: string;
    };
    originalInput: string | ({
        status: "in_progress" | "completed" | "incomplete";
        role: "assistant";
        content: ({
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        } | {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        role: "user";
        content: string | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        role: "system";
        content: string;
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "hosted_tool_call";
        name: string;
        status?: string | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        arguments?: string | undefined;
        output?: string | undefined;
    } | {
        type: "function_call";
        name: string;
        arguments: string;
        callId: string;
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "function_call_result";
        status: "in_progress" | "completed" | "incomplete";
        name: string;
        output: string | {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        } | {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        } | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        })[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "computer_call";
        status: "in_progress" | "completed" | "incomplete";
        callId: string;
        action: {
            type: "screenshot";
        } | {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        } | {
            type: "double_click";
            x: number;
            y: number;
        } | {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        } | {
            type: "type";
            text: string;
        } | {
            type: "wait";
        } | {
            type: "move";
            x: number;
            y: number;
        } | {
            keys: string[];
            type: "keypress";
        } | {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "computer_call_result";
        output: {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        };
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "shell_call";
        callId: string;
        action: {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        };
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "shell_call_output";
        output: z.objectOutputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        maxOutputLength?: number | undefined;
    } | {
        type: "apply_patch_call";
        status: "in_progress" | "completed";
        callId: string;
        operation: {
            path: string;
            type: "create_file";
            diff: string;
        } | {
            path: string;
            type: "update_file";
            diff: string;
        } | {
            path: string;
            type: "delete_file";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "apply_patch_call_output";
        status: "completed" | "failed";
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        output?: string | undefined;
    } | {
        type: "reasoning";
        content: {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[];
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        rawContent?: {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[] | undefined;
    } | {
        type: "compaction";
        encrypted_content: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        created_by?: string | undefined;
    } | {
        type: "unknown";
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    })[];
    modelResponses: {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }[];
    context: {
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        context: Record<string, any>;
        approvals: Record<string, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }>;
    };
    toolUseTracker: Record<string, string[]>;
    maxTurns: number;
    noActiveAgentRun: boolean;
    inputGuardrailResults: {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        guardrail: {
            type: "input";
            name: string;
        };
    }[];
    outputGuardrailResults: {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        agent: {
            name: string;
        };
        guardrail: {
            type: "output";
            name: string;
        };
        agentOutput?: any;
    }[];
    toolInputGuardrailResults: {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_input";
            name: string;
        };
    }[];
    toolOutputGuardrailResults: {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_output";
            name: string;
        };
    }[];
    generatedItems: ({
        type: "message_output_item";
        agent: {
            name: string;
        };
        rawItem: {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "tool_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "tool_call_output_item";
        output: string;
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        };
    } | {
        type: "reasoning_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        };
    } | {
        type: "handoff_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "handoff_output_item";
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        sourceAgent: {
            name: string;
        };
        targetAgent: {
            name: string;
        };
    } | {
        type: "tool_approval_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        toolName?: string | undefined;
    })[];
    currentAgentSpan?: SerializedSpanType | null | undefined;
    currentTurnInProgress?: boolean | undefined;
    currentStep?: {
        type: "next_step_handoff";
        newAgent?: any;
    } | {
        type: "next_step_final_output";
        output: string;
    } | {
        type: "next_step_run_again";
    } | {
        type: "next_step_interruption";
        data: Record<string, any>;
    } | undefined;
    lastModelResponse?: {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    } | undefined;
    lastProcessedResponse?: {
        handoffs: {
            handoff?: any;
            toolCall?: any;
        }[];
        newItems: ({
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectOutputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        } | {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        } | {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        } | {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        })[];
        toolsUsed: string[];
        functions: {
            toolCall?: any;
            tool?: any;
        }[];
        computerActions: {
            computer?: any;
            toolCall?: any;
        }[];
        shellActions?: {
            shell?: any;
            toolCall?: any;
        }[] | undefined;
        applyPatchActions?: {
            toolCall?: any;
            applyPatch?: any;
        }[] | undefined;
        mcpApprovalRequests?: {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }[] | undefined;
    } | undefined;
    currentTurnPersistedItemCount?: number | undefined;
    conversationId?: string | undefined;
    previousResponseId?: string | undefined;
}, {
    trace: {
        object: "trace";
        id: string;
        workflow_name: string;
        group_id: string | null;
        metadata: Record<string, any>;
        tracing_api_key?: string | null | undefined;
    } | null;
    $schemaVersion: "1.0" | "1.1";
    currentTurn: number;
    currentAgent: {
        name: string;
    };
    originalInput: string | ({
        status: "in_progress" | "completed" | "incomplete";
        role: "assistant";
        content: ({
            type: "refusal";
            refusal: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "output_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        } | {
            type: "image";
            image: string;
            providerData?: Record<string, any> | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        role: "user";
        content: string | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        } | {
            type: "audio";
            audio: string | {
                id: string;
            };
            providerData?: Record<string, any> | undefined;
            format?: string | null | undefined;
            transcript?: string | null | undefined;
        })[];
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        role: "system";
        content: string;
        type?: "message" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "hosted_tool_call";
        name: string;
        status?: string | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        arguments?: string | undefined;
        output?: string | undefined;
    } | {
        type: "function_call";
        name: string;
        arguments: string;
        callId: string;
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "function_call_result";
        status: "in_progress" | "completed" | "incomplete";
        name: string;
        output: string | {
            type: "text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                data: string | Uint8Array<ArrayBuffer>;
                mediaType?: string | undefined;
            } | {
                url: string;
            } | {
                fileId: string;
            } | undefined;
            detail?: "low" | "high" | "auto" | (string & {}) | undefined;
        } | {
            type: "file";
            file: string | {
                filename: string;
                data: string | Uint8Array<ArrayBuffer>;
                mediaType: string;
            } | {
                url: string;
                filename?: string | undefined;
            } | {
                id: string;
                filename?: string | undefined;
            };
            providerData?: Record<string, any> | undefined;
        } | ({
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        } | {
            type: "input_image";
            providerData?: Record<string, any> | undefined;
            image?: string | {
                id: string;
            } | undefined;
            detail?: string | undefined;
        } | {
            type: "input_file";
            providerData?: Record<string, any> | undefined;
            file?: string | {
                id: string;
            } | {
                url: string;
            } | undefined;
            filename?: string | undefined;
        })[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "computer_call";
        status: "in_progress" | "completed" | "incomplete";
        callId: string;
        action: {
            type: "screenshot";
        } | {
            type: "click";
            x: number;
            y: number;
            button: "left" | "right" | "wheel" | "back" | "forward";
        } | {
            type: "double_click";
            x: number;
            y: number;
        } | {
            type: "scroll";
            x: number;
            y: number;
            scroll_x: number;
            scroll_y: number;
        } | {
            type: "type";
            text: string;
        } | {
            type: "wait";
        } | {
            type: "move";
            x: number;
            y: number;
        } | {
            keys: string[];
            type: "keypress";
        } | {
            path: {
                x: number;
                y: number;
            }[];
            type: "drag";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "computer_call_result";
        output: {
            type: "computer_screenshot";
            data: string;
            providerData?: Record<string, any> | undefined;
        };
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "shell_call";
        callId: string;
        action: {
            commands: string[];
            timeoutMs?: number | undefined;
            maxOutputLength?: number | undefined;
        };
        status?: "in_progress" | "completed" | "incomplete" | undefined;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "shell_call_output";
        output: z.objectInputType<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"timeout">;
            }, "strip", z.ZodTypeAny, {
                type: "timeout";
            }, {
                type: "timeout";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"exit">;
                exitCode: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "exit";
                exitCode: number | null;
            }, {
                type: "exit";
                exitCode: number | null;
            }>]>;
        }, z.ZodTypeAny, "passthrough">[];
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        maxOutputLength?: number | undefined;
    } | {
        type: "apply_patch_call";
        status: "in_progress" | "completed";
        callId: string;
        operation: {
            path: string;
            type: "create_file";
            diff: string;
        } | {
            path: string;
            type: "update_file";
            diff: string;
        } | {
            path: string;
            type: "delete_file";
        };
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    } | {
        type: "apply_patch_call_output";
        status: "completed" | "failed";
        callId: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        output?: string | undefined;
    } | {
        type: "reasoning";
        content: {
            type: "input_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[];
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        rawContent?: {
            type: "reasoning_text";
            text: string;
            providerData?: Record<string, any> | undefined;
        }[] | undefined;
    } | {
        type: "compaction";
        encrypted_content: string;
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
        created_by?: string | undefined;
    } | {
        type: "unknown";
        providerData?: Record<string, any> | undefined;
        id?: string | undefined;
    })[];
    modelResponses: {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    }[];
    context: {
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        context: Record<string, any>;
        approvals: Record<string, {
            approved: boolean | string[];
            rejected: boolean | string[];
        }>;
    };
    toolUseTracker: Record<string, string[]>;
    maxTurns: number;
    noActiveAgentRun: boolean;
    inputGuardrailResults: {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        guardrail: {
            type: "input";
            name: string;
        };
    }[];
    outputGuardrailResults: {
        output: {
            tripwireTriggered: boolean;
            outputInfo?: any;
        };
        agent: {
            name: string;
        };
        guardrail: {
            type: "output";
            name: string;
        };
        agentOutput?: any;
    }[];
    generatedItems: ({
        type: "message_output_item";
        agent: {
            name: string;
        };
        rawItem: {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "tool_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "tool_call_output_item";
        output: string;
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call_result";
            output: {
                type: "computer_screenshot";
                data: string;
                providerData?: Record<string, any> | undefined;
            };
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        };
    } | {
        type: "reasoning_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        };
    } | {
        type: "handoff_call_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
    } | {
        type: "handoff_output_item";
        rawItem: {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        sourceAgent: {
            name: string;
        };
        targetAgent: {
            name: string;
        };
    } | {
        type: "tool_approval_item";
        agent: {
            name: string;
        };
        rawItem: {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        };
        toolName?: string | undefined;
    })[];
    currentAgentSpan?: SerializedSpanType | null | undefined;
    toolInputGuardrailResults?: {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_input";
            name: string;
        };
    }[] | undefined;
    toolOutputGuardrailResults?: {
        output: {
            behavior: {
                type: "allow";
            } | {
                message: string;
                type: "rejectContent";
            } | {
                type: "throwException";
            };
            outputInfo?: any;
        };
        guardrail: {
            type: "tool_output";
            name: string;
        };
    }[] | undefined;
    currentTurnInProgress?: boolean | undefined;
    currentStep?: {
        type: "next_step_handoff";
        newAgent?: any;
    } | {
        type: "next_step_final_output";
        output: string;
    } | {
        type: "next_step_run_again";
    } | {
        type: "next_step_interruption";
        data: Record<string, any>;
    } | undefined;
    lastModelResponse?: {
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            requests: number;
            inputTokensDetails?: Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number>[] | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
        responseId?: string | undefined;
    } | undefined;
    lastProcessedResponse?: {
        handoffs: {
            handoff?: any;
            toolCall?: any;
        }[];
        newItems: ({
            type: "message_output_item";
            agent: {
                name: string;
            };
            rawItem: {
                status: "in_progress" | "completed" | "incomplete";
                role: "assistant";
                content: ({
                    type: "refusal";
                    refusal: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "output_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "audio";
                    audio: string | {
                        id: string;
                    };
                    providerData?: Record<string, any> | undefined;
                    format?: string | null | undefined;
                    transcript?: string | null | undefined;
                } | {
                    type: "image";
                    image: string;
                    providerData?: Record<string, any> | undefined;
                })[];
                type?: "message" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call";
                status: "in_progress" | "completed" | "incomplete";
                callId: string;
                action: {
                    type: "screenshot";
                } | {
                    type: "click";
                    x: number;
                    y: number;
                    button: "left" | "right" | "wheel" | "back" | "forward";
                } | {
                    type: "double_click";
                    x: number;
                    y: number;
                } | {
                    type: "scroll";
                    x: number;
                    y: number;
                    scroll_x: number;
                    scroll_y: number;
                } | {
                    type: "type";
                    text: string;
                } | {
                    type: "wait";
                } | {
                    type: "move";
                    x: number;
                    y: number;
                } | {
                    keys: string[];
                    type: "keypress";
                } | {
                    path: {
                        x: number;
                        y: number;
                    }[];
                    type: "drag";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "tool_call_output_item";
            output: string;
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "computer_call_result";
                output: {
                    type: "computer_screenshot";
                    data: string;
                    providerData?: Record<string, any> | undefined;
                };
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call_output";
                output: z.objectInputType<{
                    stdout: z.ZodString;
                    stderr: z.ZodString;
                    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                        type: z.ZodLiteral<"timeout">;
                    }, "strip", z.ZodTypeAny, {
                        type: "timeout";
                    }, {
                        type: "timeout";
                    }>, z.ZodObject<{
                        type: z.ZodLiteral<"exit">;
                        exitCode: z.ZodNullable<z.ZodNumber>;
                    }, "strip", z.ZodTypeAny, {
                        type: "exit";
                        exitCode: number | null;
                    }, {
                        type: "exit";
                        exitCode: number | null;
                    }>]>;
                }, z.ZodTypeAny, "passthrough">[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                maxOutputLength?: number | undefined;
            } | {
                type: "apply_patch_call_output";
                status: "completed" | "failed";
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                output?: string | undefined;
            };
        } | {
            type: "reasoning_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "reasoning";
                content: {
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[];
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                rawContent?: {
                    type: "reasoning_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                }[] | undefined;
            };
        } | {
            type: "handoff_call_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
        } | {
            type: "handoff_output_item";
            rawItem: {
                type: "function_call_result";
                status: "in_progress" | "completed" | "incomplete";
                name: string;
                output: string | {
                    type: "text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType?: string | undefined;
                    } | {
                        url: string;
                    } | {
                        fileId: string;
                    } | undefined;
                    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
                } | {
                    type: "file";
                    file: string | {
                        filename: string;
                        data: string | Uint8Array<ArrayBuffer>;
                        mediaType: string;
                    } | {
                        url: string;
                        filename?: string | undefined;
                    } | {
                        id: string;
                        filename?: string | undefined;
                    };
                    providerData?: Record<string, any> | undefined;
                } | ({
                    type: "input_text";
                    text: string;
                    providerData?: Record<string, any> | undefined;
                } | {
                    type: "input_image";
                    providerData?: Record<string, any> | undefined;
                    image?: string | {
                        id: string;
                    } | undefined;
                    detail?: string | undefined;
                } | {
                    type: "input_file";
                    providerData?: Record<string, any> | undefined;
                    file?: string | {
                        id: string;
                    } | {
                        url: string;
                    } | undefined;
                    filename?: string | undefined;
                })[];
                callId: string;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            sourceAgent: {
                name: string;
            };
            targetAgent: {
                name: string;
            };
        } | {
            type: "tool_approval_item";
            agent: {
                name: string;
            };
            rawItem: {
                type: "hosted_tool_call";
                name: string;
                status?: string | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
                arguments?: string | undefined;
                output?: string | undefined;
            } | {
                type: "function_call";
                name: string;
                arguments: string;
                callId: string;
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "shell_call";
                callId: string;
                action: {
                    commands: string[];
                    timeoutMs?: number | undefined;
                    maxOutputLength?: number | undefined;
                };
                status?: "in_progress" | "completed" | "incomplete" | undefined;
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            } | {
                type: "apply_patch_call";
                status: "in_progress" | "completed";
                callId: string;
                operation: {
                    path: string;
                    type: "create_file";
                    diff: string;
                } | {
                    path: string;
                    type: "update_file";
                    diff: string;
                } | {
                    path: string;
                    type: "delete_file";
                };
                providerData?: Record<string, any> | undefined;
                id?: string | undefined;
            };
            toolName?: string | undefined;
        })[];
        toolsUsed: string[];
        functions: {
            toolCall?: any;
            tool?: any;
        }[];
        computerActions: {
            computer?: any;
            toolCall?: any;
        }[];
        shellActions?: {
            shell?: any;
            toolCall?: any;
        }[] | undefined;
        applyPatchActions?: {
            toolCall?: any;
            applyPatch?: any;
        }[] | undefined;
        mcpApprovalRequests?: {
            requestItem: {
                rawItem: {
                    type: "hosted_tool_call";
                    name: string;
                    status?: string | undefined;
                    providerData?: Record<string, any> | null | undefined;
                    arguments?: string | undefined;
                    output?: string | undefined;
                };
            };
            mcpTool: {
                type: "hosted_tool";
                providerData: Record<string, any>;
                name: "hosted_mcp";
            };
        }[] | undefined;
    } | undefined;
    currentTurnPersistedItemCount?: number | undefined;
    conversationId?: string | undefined;
    previousResponseId?: string | undefined;
}>;
/**
 * Serializable snapshot of an agent's run, including context, usage and trace.
 * While this class has publicly writable properties (prefixed with `_`), they are not meant to be
 * used directly. To read these properties, use the `RunResult` instead.
 *
 * Manipulation of the state directly can lead to unexpected behavior and should be avoided.
 * Instead, use the `approve` and `reject` methods to interact with the state.
 */
export declare class RunState<TContext, TAgent extends Agent<any, any>> {
    /**
     * Current turn number in the conversation.
     */
    _currentTurn: number;
    /**
     * Whether the current turn has already been counted (useful when resuming mid-turn).
     */
    _currentTurnInProgress: boolean;
    /**
     * The agent currently handling the conversation.
     */
    _currentAgent: TAgent;
    /**
     * Original user input prior to any processing.
     */
    _originalInput: string | AgentInputItem[];
    /**
     * Responses from the model so far.
     */
    _modelResponses: ModelResponse[];
    /**
     * Conversation identifier when the server manages conversation history.
     */
    _conversationId: string | undefined;
    /**
     * Latest response identifier returned by the server for server-managed conversations.
     */
    _previousResponseId: string | undefined;
    /**
     * Active tracing span for the current agent if tracing is enabled.
     */
    _currentAgentSpan: Span<AgentSpanData> | undefined;
    /**
     * Run context tracking approvals, usage, and other metadata.
     */
    _context: RunContext<TContext>;
    /**
     * The usage aggregated for this run. This includes per-request breakdowns when available.
     */
    get usage(): Usage;
    /**
     * Tracks what tools each agent has used.
     */
    _toolUseTracker: AgentToolUseTracker;
    /**
     * Items generated by the agent during the run.
     */
    _generatedItems: RunItem[];
    /**
     * Number of `_generatedItems` already flushed to session storage for the current turn.
     *
     * Persisting the entire turn on every save would duplicate responses and tool outputs.
     * Instead, `saveToSession` appends only the delta since the previous write. This counter
     * tracks how many generated run items from *this turn* were already written so the next
     * save can slice off only the new entries. When a turn is interrupted (e.g., awaiting tool
     * approval) and later resumed, we rewind the counter before continuing so the pending tool
     * output still gets stored.
     */
    _currentTurnPersistedItemCount: number;
    /**
     * Maximum allowed turns before forcing termination.
     */
    _maxTurns: number;
    /**
     * Whether the run has an active agent step in progress.
     */
    _noActiveAgentRun: boolean;
    /**
     * Last model response for the previous turn.
     */
    _lastTurnResponse: ModelResponse | undefined;
    /**
     * Results from input guardrails applied to the run.
     */
    _inputGuardrailResults: InputGuardrailResult[];
    /**
     * Results from output guardrails applied to the run.
     */
    _outputGuardrailResults: OutputGuardrailResult<any, any>[];
    /**
     * Results from tool input guardrails applied during tool execution.
     */
    _toolInputGuardrailResults: ToolInputGuardrailResult[];
    /**
     * Results from tool output guardrails applied during tool execution.
     */
    _toolOutputGuardrailResults: ToolOutputGuardrailResult[];
    /**
     * Next step computed for the agent to take.
     */
    _currentStep: NextStep | undefined;
    /**
     * Parsed model response after applying guardrails and tools.
     */
    _lastProcessedResponse: ProcessedResponse<TContext> | undefined;
    /**
     * Trace associated with this run if tracing is enabled.
     */
    _trace: Trace | null;
    constructor(context: RunContext<TContext>, originalInput: string | AgentInputItem[], startingAgent: TAgent, maxTurns: number);
    /**
     * Updates server-managed conversation identifiers as a single operation.
     */
    setConversationContext(conversationId?: string, previousResponseId?: string): void;
    /**
     * Updates the agent span associated with the current run.
     */
    setCurrentAgentSpan(span?: Span<AgentSpanData>): void;
    /**
     * Switches the active agent handling the run.
     */
    setCurrentAgent(agent: TAgent): void;
    /**
     * Resets the counter that tracks how many items were persisted for the current turn.
     */
    resetTurnPersistence(): void;
    /**
     * Rewinds the persisted item counter when pending approvals require re-writing outputs.
     */
    rewindTurnPersistence(count: number): void;
    /**
     * The history of the agent run. This includes the input items and the new items generated during the run.
     *
     * This can be used as inputs for the next agent run.
     */
    get history(): AgentInputItem[];
    /**
     * Returns all interruptions if the current step is an interruption otherwise returns an empty array.
     */
    getInterruptions(): any;
    /**
     * Approves a tool call requested by the agent through an interruption and approval item request.
     *
     * To approve the request use this method and then run the agent again with the same state object
     * to continue the execution.
     *
     * By default it will only approve the current tool call. To allow the tool to be used multiple
     * times throughout the run, set the `alwaysApprove` option to `true`.
     *
     * @param approvalItem - The tool call approval item to approve.
     * @param options - Options for the approval.
     */
    approve(approvalItem: RunToolApprovalItem, options?: {
        alwaysApprove?: boolean;
    }): void;
    /**
     * Rejects a tool call requested by the agent through an interruption and approval item request.
     *
     * To reject the request use this method and then run the agent again with the same state object
     * to continue the execution.
     *
     * By default it will only reject the current tool call. To allow the tool to be used multiple
     * times throughout the run, set the `alwaysReject` option to `true`.
     *
     * @param approvalItem - The tool call approval item to reject.
     * @param options - Options for the rejection.
     */
    reject(approvalItem: RunToolApprovalItem, options?: {
        alwaysReject?: boolean;
    }): void;
    /**
     * Serializes the run state to a JSON object.
     *
     * This method is used to serialize the run state to a JSON object that can be used to
     * resume the run later.
     *
     * @returns The serialized run state.
     */
    /**
     * Serializes the run state. By default, tracing API keys are omitted to prevent
     * accidental persistence of secrets. Pass `includeTracingApiKey: true` only when you
     * intentionally need to migrate a run along with its tracing credentials (e.g., to
     * rehydrate in a separate process that lacks the original environment variables).
     */
    toJSON(options?: {
        includeTracingApiKey?: boolean;
    }): z.infer<typeof SerializedRunState>;
    /**
     * Serializes the run state to a string.
     *
     * This method is used to serialize the run state to a string that can be used to
     * resume the run later.
     *
     * @returns The serialized run state.
     */
    toString(options?: {
        includeTracingApiKey?: boolean;
    }): string;
    /**
     * Deserializes a run state from a string.
     *
     * This method is used to deserialize a run state from a string that was serialized using the
     * `toString` method.
     */
    static fromString<TContext, TAgent extends Agent<any, any>>(initialAgent: TAgent, str: string): Promise<RunState<TContext, TAgent>>;
}
export {};
