"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAgentInputList = toAgentInputList;
exports.getAgentInputItemKey = getAgentInputItemKey;
exports.buildAgentInputPool = buildAgentInputPool;
exports.takeAgentInputFromPool = takeAgentInputFromPool;
exports.removeAgentInputFromPool = removeAgentInputFromPool;
exports.agentInputSerializationReplacer = agentInputSerializationReplacer;
exports.extractOutputItemsFromRunItems = extractOutputItemsFromRunItems;
exports.getTurnInput = getTurnInput;
const binary_1 = require("../utils/binary.js");
// Normalizes user-provided input into the structure the model expects. Strings become user messages,
// arrays are kept as-is so downstream loops can treat both scenarios uniformly.
function toAgentInputList(originalInput) {
    if (typeof originalInput === 'string') {
        return [{ type: 'message', role: 'user', content: originalInput }];
    }
    return [...originalInput];
}
function getAgentInputItemKey(item) {
    return JSON.stringify(item, agentInputSerializationReplacer);
}
function buildAgentInputPool(items) {
    const pool = new Map();
    for (const item of items) {
        const key = getAgentInputItemKey(item);
        const existing = pool.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            pool.set(key, [item]);
        }
    }
    return pool;
}
function takeAgentInputFromPool(pool, key) {
    const candidates = pool.get(key);
    if (!candidates || candidates.length === 0) {
        return undefined;
    }
    const [first] = candidates;
    candidates.shift();
    if (candidates.length === 0) {
        pool.delete(key);
    }
    return first;
}
function removeAgentInputFromPool(pool, item) {
    const key = getAgentInputItemKey(item);
    const candidates = pool.get(key);
    if (!candidates || candidates.length === 0) {
        return false;
    }
    const index = candidates.findIndex((candidate) => candidate === item);
    if (index === -1) {
        return false;
    }
    candidates.splice(index, 1);
    if (candidates.length === 0) {
        pool.delete(key);
    }
    return true;
}
function agentInputSerializationReplacer(_key, value) {
    const serialized = (0, binary_1.serializeBinary)(value);
    if (serialized) {
        return serialized;
    }
    return value;
}
// Extracts model-ready output items from run items, excluding approval placeholders.
function extractOutputItemsFromRunItems(items) {
    return items
        .filter((item) => item.type !== 'tool_approval_item')
        .map((item) => item.rawItem);
}
/**
 * Constructs the model input array for the current turn by combining the original turn input with
 * any new run items (excluding tool approval placeholders). This helps ensure that repeated calls
 * to the Responses API only send newly generated content.
 *
 * See: https://platform.openai.com/docs/guides/conversation-state?api-mode=responses.
 */
function getTurnInput(originalInput, generatedItems) {
    const outputItems = extractOutputItemsFromRunItems(generatedItems);
    return [...toAgentInputList(originalInput), ...outputItems];
}
//# sourceMappingURL=items.js.map