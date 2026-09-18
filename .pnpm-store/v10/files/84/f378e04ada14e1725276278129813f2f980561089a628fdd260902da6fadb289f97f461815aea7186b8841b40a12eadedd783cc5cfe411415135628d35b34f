import { z } from 'zod';
export const nextStepSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('next_step_handoff'),
        newAgent: z.any(),
    }),
    z.object({
        type: z.literal('next_step_final_output'),
        output: z.string(),
    }),
    z.object({
        type: z.literal('next_step_run_again'),
    }),
    z.object({
        type: z.literal('next_step_interruption'),
        data: z.record(z.string(), z.any()),
    }),
]);
export class SingleStepResult {
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
//# sourceMappingURL=steps.mjs.map