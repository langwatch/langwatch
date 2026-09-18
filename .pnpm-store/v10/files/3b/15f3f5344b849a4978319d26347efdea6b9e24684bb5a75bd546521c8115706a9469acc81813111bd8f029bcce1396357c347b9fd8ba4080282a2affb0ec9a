import { loadEnv } from '@openai/agents-core/_shims';
import METADATA from "./metadata.mjs";
export const DEFAULT_OPENAI_API = 'responses';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
let _defaultOpenAIAPI = DEFAULT_OPENAI_API;
let _defaultOpenAIClient;
let _defaultOpenAIKey = undefined;
let _defaultTracingApiKey = undefined;
export function setTracingExportApiKey(key) {
    _defaultTracingApiKey = key;
}
export function getTracingExportApiKey() {
    return _defaultTracingApiKey ?? loadEnv().OPENAI_API_KEY;
}
export function shouldUseResponsesByDefault() {
    return _defaultOpenAIAPI === 'responses';
}
export function setOpenAIAPI(value) {
    _defaultOpenAIAPI = value;
}
export function setDefaultOpenAIClient(client) {
    _defaultOpenAIClient = client;
}
export function getDefaultOpenAIClient() {
    return _defaultOpenAIClient;
}
export function setDefaultOpenAIKey(key) {
    _defaultOpenAIKey = key;
}
export function getDefaultOpenAIKey() {
    return _defaultOpenAIKey ?? loadEnv().OPENAI_API_KEY;
}
export const HEADERS = {
    'User-Agent': `Agents/JavaScript ${METADATA.version}`,
};
//# sourceMappingURL=defaults.mjs.map