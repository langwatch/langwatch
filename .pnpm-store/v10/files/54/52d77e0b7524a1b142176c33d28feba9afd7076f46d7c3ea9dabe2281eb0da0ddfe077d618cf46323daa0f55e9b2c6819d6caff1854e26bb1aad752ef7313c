"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectModel = selectModel;
exports.maybeResetToolChoice = maybeResetToolChoice;
exports.adjustModelSettingsForNonGPT5RunnerModel = adjustModelSettingsForNonGPT5RunnerModel;
const agent_1 = require("../agent.js");
const defaultModel_1 = require("../defaultModel.js");
const hasGpt5OnlySettings = (settings) => {
    const providerData = settings?.providerData;
    return Boolean(providerData?.reasoning ||
        providerData?.text?.verbosity ||
        providerData
            ?.reasoning_effort);
};
/**
 * Resolves the effective model for the next turn by giving precedence to the agent-specific
 * configuration when present, otherwise falling back to the runner-level default.
 */
function selectModel(agentModel, runConfigModel) {
    if ((typeof agentModel === 'string' &&
        agentModel !== agent_1.Agent.DEFAULT_MODEL_PLACEHOLDER) ||
        agentModel) {
        return agentModel;
    }
    return runConfigModel ?? agentModel ?? agent_1.Agent.DEFAULT_MODEL_PLACEHOLDER;
}
/**
 * Resets the tool choice when the agent is configured to prefer a fresh tool selection after
 * any tool usage. This prevents the provider from reusing stale tool hints across turns.
 */
function maybeResetToolChoice(agent, toolUseTracker, modelSettings) {
    if (agent.resetToolChoice && toolUseTracker.hasUsedTools(agent)) {
        return { ...modelSettings, toolChoice: undefined };
    }
    return modelSettings;
}
/**
 * When the default model is a GPT-5 variant, agents may carry GPT-5-specific providerData
 * (e.g., reasoning effort, text verbosity). If a run resolves to a non-GPT-5 model and the
 * agent relied on the default model (i.e., no explicit model set), these GPT-5-only settings
 * are incompatible and should be stripped to avoid runtime errors.
 */
function adjustModelSettingsForNonGPT5RunnerModel(explictlyModelSet, agentModelSettings, runnerModel, modelSettings, resolvedModelName) {
    const modelName = resolvedModelName ??
        (typeof runnerModel === 'string'
            ? runnerModel
            : (runnerModel
                ?.model ?? runnerModel?.name));
    const isNonGpt5RunnerModel = typeof modelName === 'string'
        ? !(0, defaultModel_1.gpt5ReasoningSettingsRequired)(modelName)
        : true;
    const hasGpt5Defaults = hasGpt5OnlySettings(agentModelSettings) ||
        hasGpt5OnlySettings(modelSettings);
    if ((0, defaultModel_1.isGpt5Default)() &&
        explictlyModelSet &&
        isNonGpt5RunnerModel &&
        hasGpt5Defaults) {
        return stripGpt5OnlySettings(modelSettings);
    }
    return modelSettings;
}
function stripGpt5OnlySettings(modelSettings) {
    const copiedProviderData = modelSettings.providerData
        ? { ...modelSettings.providerData }
        : undefined;
    if (copiedProviderData) {
        if (copiedProviderData.text &&
            typeof copiedProviderData.text === 'object') {
            copiedProviderData.text = { ...copiedProviderData.text };
            delete copiedProviderData.text.verbosity;
        }
        delete copiedProviderData.reasoning;
        delete copiedProviderData.reasoning_effort;
    }
    const copiedModelSettings = {
        ...modelSettings,
        providerData: copiedProviderData,
    };
    if (modelSettings.reasoning) {
        copiedModelSettings.reasoning = { ...modelSettings.reasoning };
    }
    if (modelSettings.text) {
        copiedModelSettings.text = { ...modelSettings.text };
    }
    delete copiedModelSettings.providerData?.reasoning;
    delete copiedModelSettings.providerData?.text?.verbosity;
    delete copiedModelSettings.providerData?.reasoning_effort;
    if (copiedModelSettings.reasoning) {
        delete copiedModelSettings.reasoning.effort;
        delete copiedModelSettings.reasoning.summary;
    }
    if (copiedModelSettings.text) {
        delete copiedModelSettings.text.verbosity;
    }
    return copiedModelSettings;
}
//# sourceMappingURL=modelSettings.js.map