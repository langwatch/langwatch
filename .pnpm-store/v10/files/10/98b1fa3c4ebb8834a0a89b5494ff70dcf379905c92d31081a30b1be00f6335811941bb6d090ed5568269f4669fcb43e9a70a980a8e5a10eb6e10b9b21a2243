"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunToolApprovalItem = exports.RunHandoffOutputItem = exports.RunHandoffCallItem = exports.RunReasoningItem = exports.RunToolCallOutputItem = exports.RunToolCallItem = exports.RunMessageOutputItem = exports.RunItemBase = void 0;
exports.extractAllTextOutput = extractAllTextOutput;
const smartString_1 = require("./utils/smartString.js");
class RunItemBase {
    type = 'base_item';
    rawItem;
    toJSON() {
        return {
            type: this.type,
            rawItem: this.rawItem,
        };
    }
}
exports.RunItemBase = RunItemBase;
class RunMessageOutputItem extends RunItemBase {
    rawItem;
    agent;
    type = 'message_output_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
    get content() {
        let content = '';
        for (const part of this.rawItem.content) {
            if (part.type === 'output_text') {
                content += part.text;
            }
        }
        return content;
    }
}
exports.RunMessageOutputItem = RunMessageOutputItem;
class RunToolCallItem extends RunItemBase {
    rawItem;
    agent;
    type = 'tool_call_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
exports.RunToolCallItem = RunToolCallItem;
class RunToolCallOutputItem extends RunItemBase {
    rawItem;
    agent;
    output;
    type = 'tool_call_output_item';
    constructor(rawItem, agent, output) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
        this.output = output;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
            output: (0, smartString_1.toSmartString)(this.output),
        };
    }
}
exports.RunToolCallOutputItem = RunToolCallOutputItem;
class RunReasoningItem extends RunItemBase {
    rawItem;
    agent;
    type = 'reasoning_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
exports.RunReasoningItem = RunReasoningItem;
class RunHandoffCallItem extends RunItemBase {
    rawItem;
    agent;
    type = 'handoff_call_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
exports.RunHandoffCallItem = RunHandoffCallItem;
class RunHandoffOutputItem extends RunItemBase {
    rawItem;
    sourceAgent;
    targetAgent;
    type = 'handoff_output_item';
    constructor(rawItem, sourceAgent, targetAgent) {
        super();
        this.rawItem = rawItem;
        this.sourceAgent = sourceAgent;
        this.targetAgent = targetAgent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            sourceAgent: this.sourceAgent.toJSON(),
            targetAgent: this.targetAgent.toJSON(),
        };
    }
}
exports.RunHandoffOutputItem = RunHandoffOutputItem;
class RunToolApprovalItem extends RunItemBase {
    rawItem;
    agent;
    toolName;
    type = 'tool_approval_item';
    constructor(rawItem, agent, 
    /**
     * Explicit tool name to use for approval tracking when not present on the raw item.
     */
    toolName) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
        this.toolName = toolName;
        this.toolName = toolName ?? rawItem.name;
    }
    /**
     * Returns the tool name if available on the raw item or provided explicitly.
     * Kept for backwards compatibility with code that previously relied on `rawItem.name`.
     */
    get name() {
        return this.toolName ?? this.rawItem.name;
    }
    /**
     * Returns the arguments if the raw item has an arguments property otherwise this will be undefined.
     */
    get arguments() {
        return 'arguments' in this.rawItem ? this.rawItem.arguments : undefined;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
            toolName: this.toolName,
        };
    }
}
exports.RunToolApprovalItem = RunToolApprovalItem;
/**
 * Extract all text output from a list of run items by concatenating the content of all
 * message output items.
 *
 * @param items - The list of run items to extract text from.
 * @returns A string of all the text output from the run items.
 */
function extractAllTextOutput(items) {
    return items
        .filter((item) => item.type === 'message_output_item')
        .map((item) => item.content)
        .join('');
}
//# sourceMappingURL=items.js.map