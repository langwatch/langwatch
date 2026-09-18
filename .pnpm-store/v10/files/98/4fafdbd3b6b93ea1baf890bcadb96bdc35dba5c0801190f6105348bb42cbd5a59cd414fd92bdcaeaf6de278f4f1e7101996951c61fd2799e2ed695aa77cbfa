import { RunHandoffCallItem, RunHandoffOutputItem, RunToolCallItem, RunToolCallOutputItem, } from "../items.mjs";
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
export function removeAllTools(handoffInputData) {
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
    return items.filter((item) => !(item instanceof RunHandoffCallItem) &&
        !(item instanceof RunHandoffOutputItem) &&
        !(item instanceof RunToolCallItem) &&
        !(item instanceof RunToolCallOutputItem));
}
function removeToolTypesFromInput(items) {
    return items.filter((item) => !TOOL_TYPES.has(item.type ?? ''));
}
//# sourceMappingURL=handoffFilters.mjs.map