import { ModelSettings } from './model';
export declare const OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME = "OPENAI_DEFAULT_MODEL";
/**
 * Returns True if the model name is a GPT-5 model and reasoning settings are required.
 */
export declare function gpt5ReasoningSettingsRequired(modelName: string): boolean;
/**
 * Returns True if the default model is a GPT-5 model.
 * This is used to determine if the default model settings are compatible with GPT-5 models.
 * If the default model is not a GPT-5 model, the model settings are compatible with other models.
 */
export declare function isGpt5Default(): boolean;
/**
 * Returns the default model name.
 */
export declare function getDefaultModel(): string;
/**
 * Returns the default model settings.
 * If the default model is a GPT-5 model, returns the GPT-5 default model settings.
 * Otherwise, returns the legacy default model settings.
 */
export declare function getDefaultModelSettings(model?: string): ModelSettings;
