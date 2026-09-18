"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeExecute = safeExecute;
async function safeExecute(fn) {
    try {
        return [null, await fn()];
    }
    catch (error) {
        return [error, null];
    }
}
//# sourceMappingURL=safeExecute.js.map