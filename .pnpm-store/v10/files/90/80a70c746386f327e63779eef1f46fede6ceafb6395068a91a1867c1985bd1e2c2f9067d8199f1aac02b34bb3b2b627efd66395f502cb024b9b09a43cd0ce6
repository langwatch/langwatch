"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADERS = exports.DEFAULT_OPENAI_MODEL = exports.DEFAULT_OPENAI_API = void 0;
exports.setTracingExportApiKey = setTracingExportApiKey;
exports.getTracingExportApiKey = getTracingExportApiKey;
exports.shouldUseResponsesByDefault = shouldUseResponsesByDefault;
exports.setOpenAIAPI = setOpenAIAPI;
exports.setDefaultOpenAIClient = setDefaultOpenAIClient;
exports.getDefaultOpenAIClient = getDefaultOpenAIClient;
exports.setDefaultOpenAIKey = setDefaultOpenAIKey;
exports.getDefaultOpenAIKey = getDefaultOpenAIKey;
const _shims_1 = require("@openai/agents-core/_shims");
const metadata_1 = __importDefault(require("./metadata.js"));
exports.DEFAULT_OPENAI_API = 'responses';
exports.DEFAULT_OPENAI_MODEL = 'gpt-4.1';
let _defaultOpenAIAPI = exports.DEFAULT_OPENAI_API;
let _defaultOpenAIClient;
let _defaultOpenAIKey = undefined;
let _defaultTracingApiKey = undefined;
function setTracingExportApiKey(key) {
    _defaultTracingApiKey = key;
}
function getTracingExportApiKey() {
    return _defaultTracingApiKey ?? (0, _shims_1.loadEnv)().OPENAI_API_KEY;
}
function shouldUseResponsesByDefault() {
    return _defaultOpenAIAPI === 'responses';
}
function setOpenAIAPI(value) {
    _defaultOpenAIAPI = value;
}
function setDefaultOpenAIClient(client) {
    _defaultOpenAIClient = client;
}
function getDefaultOpenAIClient() {
    return _defaultOpenAIClient;
}
function setDefaultOpenAIKey(key) {
    _defaultOpenAIKey = key;
}
function getDefaultOpenAIKey() {
    return _defaultOpenAIKey ?? (0, _shims_1.loadEnv)().OPENAI_API_KEY;
}
exports.HEADERS = {
    'User-Agent': `Agents/JavaScript ${metadata_1.default.version}`,
};
//# sourceMappingURL=defaults.js.map