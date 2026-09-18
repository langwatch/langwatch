import { RuntimeEventEmitter, } from '@openai/agents-core/_shims';
export class EventEmitterDelegate {
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
/**
 * Event emitter that every Agent instance inherits from and that emits events for the lifecycle
 * of the agent.
 */
export class AgentHooks extends EventEmitterDelegate {
    eventEmitter = new RuntimeEventEmitter();
}
/**
 * Event emitter that every Runner instance inherits from and that emits events for the lifecycle
 * of the overall run.
 */
export class RunHooks extends EventEmitterDelegate {
    eventEmitter = new RuntimeEventEmitter();
}
//# sourceMappingURL=lifecycle.mjs.map