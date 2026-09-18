import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { BehaviorOverride } from "./BehaviorOverride";
import { PromptAgentApiModelOutput } from "./PromptAgentApiModelOutput";
export declare const AgentConfig: core.serialization.ObjectSchema<serializers.AgentConfig.Raw, ElevenLabs.AgentConfig>;
export declare namespace AgentConfig {
    interface Raw {
        first_message?: string | null;
        language?: string | null;
        hinglish_mode?: boolean | null;
        dynamic_variables?: unknown | null;
        disable_first_message_interruptions?: boolean | null;
        max_conversation_duration_message?: string | null;
        text_behavior_overrides?: Record<string, BehaviorOverride.Raw | null | undefined> | null;
        prompt?: PromptAgentApiModelOutput.Raw | null;
    }
}
