"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAbortError = void 0;
exports.streamStepItemsToRunResult = streamStepItemsToRunResult;
exports.addStepToRunResult = addStepToRunResult;
const logger_1 = __importDefault(require("../logger.js"));
const events_1 = require("../events.js");
const items_1 = require("../items.js");
const isAbortError = (error) => {
    if (!error) {
        return false;
    }
    if (error instanceof Error && error.name === 'AbortError') {
        return true;
    }
    const DomExceptionCtor = typeof DOMException !== 'undefined' ? DOMException : undefined;
    if (DomExceptionCtor &&
        error instanceof DomExceptionCtor &&
        error.name === 'AbortError') {
        return true;
    }
    return false;
};
exports.isAbortError = isAbortError;
function getRunItemStreamEventName(item) {
    if (item instanceof items_1.RunMessageOutputItem) {
        return 'message_output_created';
    }
    if (item instanceof items_1.RunHandoffCallItem) {
        return 'handoff_requested';
    }
    if (item instanceof items_1.RunHandoffOutputItem) {
        return 'handoff_occurred';
    }
    if (item instanceof items_1.RunToolCallItem) {
        return 'tool_called';
    }
    if (item instanceof items_1.RunToolCallOutputItem) {
        return 'tool_output';
    }
    if (item instanceof items_1.RunReasoningItem) {
        return 'reasoning_item_created';
    }
    if (item instanceof items_1.RunToolApprovalItem) {
        return 'tool_approval_requested';
    }
    return undefined;
}
function enqueueRunItemStreamEvent(result, item) {
    const itemName = getRunItemStreamEventName(item);
    if (!itemName) {
        logger_1.default.warn('Unknown item type: ', item);
        return;
    }
    result._addItem(new events_1.RunItemStreamEvent(itemName, item));
}
function streamStepItemsToRunResult(result, items) {
    for (const item of items) {
        enqueueRunItemStreamEvent(result, item);
    }
}
function addStepToRunResult(result, step, options) {
    const skippedItems = options?.skipItems;
    for (const item of step.newStepItems) {
        if (skippedItems?.has(item)) {
            continue;
        }
        enqueueRunItemStreamEvent(result, item);
    }
}
//# sourceMappingURL=streaming.js.map