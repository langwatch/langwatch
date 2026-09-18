"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeAllTools = removeAllTools;
const items_1 = require("../items.js");
const TOOL_TYPES = new Set([
    'function_call',
    'function_call_result',
    'computer_call',
    'computer_call_result',
    'shell_call',
    'shell_call_output',
    'apply_patch_call',
    'apply_patch_call_output',
    'hosted_tool_call',
]);
/**
 * Filters out all tool items: file search, web search and function calls+output
 * @param handoffInputData
 * @returns
 */
function removeAllTools(handoffInputData) {
    const { inputHistory, preHandoffItems, newItems, runContext } = handoffInputData;
    const filteredHistory = Array.isArray(inputHistory)
        ? removeToolTypesFromInput(inputHistory)
        : inputHistory;
    const filteredPreHandoffItems = removeToolsFromItems(preHandoffItems);
    const filteredNewItems = removeToolsFromItems(newItems);
    return {
        inputHistory: filteredHistory,
        preHandoffItems: filteredPreHandoffItems,
        newItems: filteredNewItems,
        runContext,
    };
}
function removeToolsFromItems(items) {
    return items.filter((item) => !(item instanceof items_1.RunHandoffCallItem) &&
        !(item instanceof items_1.RunHandoffOutputItem) &&
        !(item instanceof items_1.RunToolCallItem) &&
        !(item instanceof items_1.RunToolCallOutputItem));
}
function removeToolTypesFromInput(items) {
    return items.filter((item) => !TOOL_TYPES.has(item.type ?? ''));
}
//# sourceMappingURL=handoffFilters.js.map