export async function safeExecute(fn) {
    try {
        return [null, await fn()];
    }
    catch (error) {
        return [error, null];
    }
}
//# sourceMappingURL=safeExecute.mjs.map