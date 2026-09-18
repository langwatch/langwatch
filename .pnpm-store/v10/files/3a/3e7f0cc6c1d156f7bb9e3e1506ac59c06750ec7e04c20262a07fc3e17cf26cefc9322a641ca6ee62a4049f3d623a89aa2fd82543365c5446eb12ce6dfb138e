import type * as ElevenLabs from "../index";
export interface AgentConfigApiModelWorkflowOverrideOutput {
    /** If non-empty, the first message the agent will say. If empty, the agent waits for the user to start the discussion. */
    firstMessage?: string;
    /** Language of the agent - used for ASR and TTS */
    language?: string;
    /** When enabled and language is Hindi, the agent will respond in Hinglish */
    hinglishMode?: boolean;
    /** Configuration for dynamic variables */
    dynamicVariables?: ElevenLabs.DynamicVariablesConfigWorkflowOverride;
    /** If true, the user will not be able to interrupt the agent while the first message is being delivered. */
    disableFirstMessageInterruptions?: boolean;
    /** If non-empty, the message the agent will send when max conversation duration is reached. */
    maxConversationDurationMessage?: string;
    /** Per-channel response behavior overrides for text conversations. Built-in channel defaults apply when unset. */
    textBehaviorOverrides?: Record<string, ElevenLabs.BehaviorOverride | undefined>;
    /** The prompt for the agent */
    prompt?: ElevenLabs.PromptAgentApiModelWorkflowOverrideOutput;
}
