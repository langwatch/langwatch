import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { BehaviorOverride } from "./BehaviorOverride";
import { DynamicVariablesConfigWorkflowOverride } from "./DynamicVariablesConfigWorkflowOverride";
import { PromptAgentApiModelWorkflowOverrideInput } from "./PromptAgentApiModelWorkflowOverrideInput";
export declare const AgentConfigApiModelWorkflowOverrideInput: core.serialization.ObjectSchema<serializers.AgentConfigApiModelWorkflowOverrideInput.Raw, ElevenLabs.AgentConfigApiModelWorkflowOverrideInput>;
export declare namespace AgentConfigApiModelWorkflowOverrideInput {
    interface Raw {
        first_message?: string | null;
        language?: string | null;
        hinglish_mode?: boolean | null;
        dynamic_variables?: DynamicVariablesConfigWorkflowOverride.Raw | null;
        disable_first_message_interruptions?: boolean | null;
        max_conversation_duration_message?: string | null;
        text_behavior_overrides?: Record<string, BehaviorOverride.Raw | null | undefined> | null;
        prompt?: PromptAgentApiModelWorkflowOverrideInput.Raw | null;
    }
}
