import { loadEnv } from "./config.mjs";
export const OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME = 'OPENAI_DEFAULT_MODEL';
/**
 * Returns True if the model name is a GPT-5 model and reasoning settings are required.
 */
export function gpt5ReasoningSettingsRequired(modelName) {
    if (modelName.startsWith('gpt-5-chat')) {
        // gpt-5-chat-latest does not require reasoning settings
        return false;
    }
    // matches any of gpt-5 models
    return modelName.startsWith('gpt-5');
}
/**
 * Returns True if the default model is a GPT-5 model.
 * This is used to determine if the default model settings are compatible with GPT-5 models.
 * If the default model is not a GPT-5 model, the model settings are compatible with other models.
 */
export function isGpt5Default() {
    return gpt5ReasoningSettingsRequired(getDefaultModel());
}
/**
 * Returns the default model name.
 */
export function getDefaultModel() {
    const env = loadEnv();
    return (env[OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME]?.toLowerCase() ?? 'gpt-4.1');
}
/**
 * Returns the default model settings.
 * If the default model is a GPT-5 model, returns the GPT-5 default model settings.
 * Otherwise, returns the legacy default model settings.
 */
export function getDefaultModelSettings(model) {
    const _model = model ?? getDefaultModel();
    if (gpt5ReasoningSettingsRequired(_model)) {
        return {
            // We chose "low" instead of "minimal" because some of the built-in tools
            // (e.g., file search, image generation, etc.) do not support "minimal"
            // If you want to use "minimal" reasoning effort, you can pass your own model settings
            reasoning: { effort: 'low' },
            text: { verbosity: 'low' },
        };
    }
    return {};
}
//# sourceMappingURL=defaultModel.mjs.map