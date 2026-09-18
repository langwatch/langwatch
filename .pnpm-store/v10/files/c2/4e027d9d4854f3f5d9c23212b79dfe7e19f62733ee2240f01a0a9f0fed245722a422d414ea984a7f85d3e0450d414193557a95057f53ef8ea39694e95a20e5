"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimeoutSignal = getTimeoutSignal;
exports.anySignal = anySignal;
const TIMEOUT = "timeout";
function getTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const abortId = setTimeout(() => controller.abort(TIMEOUT), timeoutMs);
    return { signal: controller.signal, abortId };
}
function anySignal(...args) {
    const signals = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal === null || signal === void 0 ? void 0 : signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal === null || signal === void 0 ? void 0 : signal.reason), {
            signal: controller.signal,
        });
    }
    return controller.signal;
}
