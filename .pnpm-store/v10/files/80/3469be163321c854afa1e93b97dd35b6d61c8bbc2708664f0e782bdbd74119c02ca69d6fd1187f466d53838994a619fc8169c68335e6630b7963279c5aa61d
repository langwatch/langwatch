/**
 * Defines an input guardrail definition.
 */
export function defineInputGuardrail({ name, execute, runInParallel = true, }) {
    return {
        type: 'input',
        name,
        runInParallel,
        guardrailFunction: execute,
        async run(args) {
            return {
                guardrail: { type: 'input', name },
                output: await execute(args),
            };
        },
    };
}
/**
 * Creates an output guardrail definition.
 */
export function defineOutputGuardrail({ name, execute, }) {
    return {
        type: 'output',
        name,
        guardrailFunction: execute,
        async run(args) {
            return {
                guardrail: { type: 'output', name },
                agent: args.agent,
                agentOutput: args.agentOutput,
                output: await execute(args),
            };
        },
    };
}
//# sourceMappingURL=guardrail.mjs.map