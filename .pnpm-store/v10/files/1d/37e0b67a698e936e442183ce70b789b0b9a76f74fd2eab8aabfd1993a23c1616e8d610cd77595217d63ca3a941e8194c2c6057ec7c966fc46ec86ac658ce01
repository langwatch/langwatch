import { serializeBinary } from "../utils/binary.mjs";
// Normalizes user-provided input into the structure the model expects. Strings become user messages,
// arrays are kept as-is so downstream loops can treat both scenarios uniformly.
export function toAgentInputList(originalInput) {
    if (typeof originalInput === 'string') {
        return [{ type: 'message', role: 'user', content: originalInput }];
    }
    return [...originalInput];
}
export function getAgentInputItemKey(item) {
    return JSON.stringify(item, agentInputSerializationReplacer);
}
export function buildAgentInputPool(items) {
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
export function takeAgentInputFromPool(pool, key) {
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
export function removeAgentInputFromPool(pool, item) {
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
export function agentInputSerializationReplacer(_key, value) {
    const serialized = serializeBinary(value);
    if (serialized) {
        return serialized;
    }
    return value;
}
// Extracts model-ready output items from run items, excluding approval placeholders.
export function extractOutputItemsFromRunItems(items) {
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
export function getTurnInput(originalInput, generatedItems) {
    const outputItems = extractOutputItemsFromRunItems(generatedItems);
    return [...toAgentInputList(originalInput), ...outputItems];
}
//# sourceMappingURL=items.mjs.map