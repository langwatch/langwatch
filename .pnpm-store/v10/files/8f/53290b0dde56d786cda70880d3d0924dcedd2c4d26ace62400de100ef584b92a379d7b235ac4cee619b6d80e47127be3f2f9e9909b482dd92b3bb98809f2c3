import { z } from 'zod';
import { ModelResponse } from '../model';
import { RunItem } from '../items';
import { AgentInputItem } from '../types';
export declare const nextStepSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
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
}>]>;
export type NextStep = z.infer<typeof nextStepSchema>;
export declare class SingleStepResult {
    originalInput: string | AgentInputItem[];
    modelResponse: ModelResponse;
    preStepItems: RunItem[];
    newStepItems: RunItem[];
    nextStep: NextStep;
    constructor(originalInput: string | AgentInputItem[], modelResponse: ModelResponse, preStepItems: RunItem[], newStepItems: RunItem[], nextStep: NextStep);
    get generatedItems(): RunItem[];
}
