"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleStepResult = exports.nextStepSchema = void 0;
const zod_1 = require("zod");
exports.nextStepSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({
        type: zod_1.z.literal('next_step_handoff'),
        newAgent: zod_1.z.any(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('next_step_final_output'),
        output: zod_1.z.string(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('next_step_run_again'),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('next_step_interruption'),
        data: zod_1.z.record(zod_1.z.string(), zod_1.z.any()),
    }),
]);
class SingleStepResult {
    originalInput;
    modelResponse;
    preStepItems;
    newStepItems;
    nextStep;
    constructor(originalInput, modelResponse, preStepItems, newStepItems, nextStep) {
        this.originalInput = originalInput;
        this.modelResponse = modelResponse;
        this.preStepItems = preStepItems;
        this.newStepItems = newStepItems;
        this.nextStep = nextStep;
    }
    get generatedItems() {
        return this.preStepItems.concat(this.newStepItems);
    }
}
exports.SingleStepResult = SingleStepResult;
//# sourceMappingURL=steps.js.map