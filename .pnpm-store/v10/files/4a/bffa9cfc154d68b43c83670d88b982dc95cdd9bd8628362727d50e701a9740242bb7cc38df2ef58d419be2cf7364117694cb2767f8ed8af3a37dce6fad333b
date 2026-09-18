"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TracerProvider = void 0;
const api_1 = require("@opentelemetry/api");
const resources_1 = require("@opentelemetry/resources");
const Tracer_1 = require("./Tracer");
const MultiSpanProcessor_1 = require("./MultiSpanProcessor");
const ParentBasedSampler_1 = require("./sampler/ParentBasedSampler");
const AlwaysOnSampler_1 = require("./sampler/AlwaysOnSampler");
const platform_1 = require("./platform");
const inspect_1 = require("./inspect");
var ForceFlushState;
(function (ForceFlushState) {
    ForceFlushState[ForceFlushState["resolved"] = 0] = "resolved";
    ForceFlushState[ForceFlushState["timeout"] = 1] = "timeout";
    ForceFlushState[ForceFlushState["error"] = 2] = "error";
    ForceFlushState[ForceFlushState["unresolved"] = 3] = "unresolved";
})(ForceFlushState || (ForceFlushState = {}));
/**
 * This class represents a basic tracer provider which platform libraries can extend
 */
class TracerProvider {
    _resource;
    _activeSpanProcessor;
    _forceFlushTimeoutMillis;
    _tracerOptions;
    _tracers = new Map();
    constructor(options = {}) {
        this._forceFlushTimeoutMillis = options.forceFlushTimeoutMillis ?? 30000;
        this._resource = options.resource ?? (0, resources_1.defaultResource)();
        const spanProcessors = options.spanProcessors ?? [];
        this._activeSpanProcessor = new MultiSpanProcessor_1.MultiSpanProcessor(spanProcessors);
        this._tracerOptions = {
            resource: this._resource,
            sampler: options.sampler ??
                new ParentBasedSampler_1.ParentBasedSampler({
                    root: new AlwaysOnSampler_1.AlwaysOnSampler(),
                }),
            spanLimits: {
                attributeCountLimit: options.spanLimits?.attributeCountLimit ?? 128,
                attributeValueLengthLimit: options.spanLimits?.attributeValueLengthLimit ?? Infinity,
                eventCountLimit: options.spanLimits?.eventCountLimit ?? 128,
                linkCountLimit: options.spanLimits?.linkCountLimit ?? 128,
                attributePerEventCountLimit: options.spanLimits?.attributePerEventCountLimit ?? 128,
                attributePerLinkCountLimit: options.spanLimits?.attributePerLinkCountLimit ?? 128,
            },
            idGenerator: options.idGenerator || new platform_1.RandomIdGenerator(),
            spanProcessor: this._activeSpanProcessor,
            meterProvider: options.meterProvider ?? {
                getMeter() {
                    return (0, api_1.createNoopMeter)();
                },
            },
        };
    }
    getTracer(name, version, options) {
        const key = `${name}@${version || ''}:${options?.schemaUrl || ''}`;
        if (!this._tracers.has(key)) {
            this._tracers.set(key, new Tracer_1.Tracer({ name, version, schemaUrl: options?.schemaUrl }, this._tracerOptions));
        }
        return this._tracers.get(key);
    }
    forceFlush() {
        const timeout = this._forceFlushTimeoutMillis;
        const promises = this._activeSpanProcessor['_spanProcessors'].map((spanProcessor) => {
            return new Promise(resolve => {
                let state;
                const timeoutInterval = setTimeout(() => {
                    resolve(new Error(`Span processor did not completed within timeout period of ${timeout} ms`));
                    state = ForceFlushState.timeout;
                }, timeout);
                spanProcessor
                    .forceFlush()
                    .then(() => {
                    clearTimeout(timeoutInterval);
                    if (state !== ForceFlushState.timeout) {
                        state = ForceFlushState.resolved;
                        resolve(state);
                    }
                })
                    .catch(error => {
                    clearTimeout(timeoutInterval);
                    state = ForceFlushState.error;
                    resolve(error);
                });
            });
        });
        return new Promise((resolve, reject) => {
            Promise.all(promises)
                .then(results => {
                const errors = results.filter(result => result !== ForceFlushState.resolved);
                if (errors.length > 0) {
                    reject(errors);
                }
                else {
                    resolve();
                }
            })
                .catch(error => reject([error]));
        });
    }
    shutdown() {
        return this._activeSpanProcessor.shutdown();
    }
    [inspect_1.inspectCustom](depth, options, inspect) {
        const processors = this._activeSpanProcessor['_spanProcessors'];
        const payload = {
            resource: { attributes: (0, inspect_1.settledResourceAttributes)(this._resource) },
            tracers: Array.from(this._tracers.keys()),
            spanProcessors: processors.map(p => p.constructor?.name ?? 'SpanProcessor'),
        };
        return (0, inspect_1.formatInspect)('TracerProvider', payload, depth, options, inspect);
    }
}
exports.TracerProvider = TracerProvider;
//# sourceMappingURL=TracerProvider.js.map