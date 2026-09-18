"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunHooks = exports.AgentHooks = exports.EventEmitterDelegate = void 0;
const _shims_1 = require("@openai/agents-core/_shims");
class EventEmitterDelegate {
    on(type, listener) {
        this.eventEmitter.on(type, listener);
        return this.eventEmitter;
    }
    off(type, listener) {
        this.eventEmitter.off(type, listener);
        return this.eventEmitter;
    }
    emit(type, ...args) {
        return this.eventEmitter.emit(type, ...args);
    }
    once(type, listener) {
        this.eventEmitter.once(type, listener);
        return this.eventEmitter;
    }
}
exports.EventEmitterDelegate = EventEmitterDelegate;
/**
 * Event emitter that every Agent instance inherits from and that emits events for the lifecycle
 * of the agent.
 */
class AgentHooks extends EventEmitterDelegate {
    eventEmitter = new _shims_1.RuntimeEventEmitter();
}
exports.AgentHooks = AgentHooks;
/**
 * Event emitter that every Runner instance inherits from and that emits events for the lifecycle
 * of the overall run.
 */
class RunHooks extends EventEmitterDelegate {
    eventEmitter = new _shims_1.RuntimeEventEmitter();
}
exports.RunHooks = RunHooks;
//# sourceMappingURL=lifecycle.js.map