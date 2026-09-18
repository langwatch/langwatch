/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createNoopMeter } from '@opentelemetry/api';
import { defaultResource } from '@opentelemetry/resources';
import { Tracer } from './Tracer';
import { MultiSpanProcessor } from './MultiSpanProcessor';
import { ParentBasedSampler } from './sampler/ParentBasedSampler';
import { AlwaysOnSampler } from './sampler/AlwaysOnSampler';
import { RandomIdGenerator } from './platform';
import { formatInspect, inspectCustom, settledResourceAttributes, } from './inspect';
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
export class TracerProvider {
    _resource;
    _activeSpanProcessor;
    _forceFlushTimeoutMillis;
    _tracerOptions;
    _tracers = new Map();
    constructor(options = {}) {
        this._forceFlushTimeoutMillis = options.forceFlushTimeoutMillis ?? 30000;
        this._resource = options.resource ?? defaultResource();
        const spanProcessors = options.spanProcessors ?? [];
        this._activeSpanProcessor = new MultiSpanProcessor(spanProcessors);
        this._tracerOptions = {
            resource: this._resource,
            sampler: options.sampler ??
                new ParentBasedSampler({
                    root: new AlwaysOnSampler(),
                }),
            spanLimits: {
                attributeCountLimit: options.spanLimits?.attributeCountLimit ?? 128,
                attributeValueLengthLimit: options.spanLimits?.attributeValueLengthLimit ?? Infinity,
                eventCountLimit: options.spanLimits?.eventCountLimit ?? 128,
                linkCountLimit: options.spanLimits?.linkCountLimit ?? 128,
                attributePerEventCountLimit: options.spanLimits?.attributePerEventCountLimit ?? 128,
                attributePerLinkCountLimit: options.spanLimits?.attributePerLinkCountLimit ?? 128,
            },
            idGenerator: options.idGenerator || new RandomIdGenerator(),
            spanProcessor: this._activeSpanProcessor,
            meterProvider: options.meterProvider ?? {
                getMeter() {
                    return createNoopMeter();
                },
            },
        };
    }
    getTracer(name, version, options) {
        const key = `${name}@${version || ''}:${options?.schemaUrl || ''}`;
        if (!this._tracers.has(key)) {
            this._tracers.set(key, new Tracer({ name, version, schemaUrl: options?.schemaUrl }, this._tracerOptions));
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
    [inspectCustom](depth, options, inspect) {
        const processors = this._activeSpanProcessor['_spanProcessors'];
        const payload = {
            resource: { attributes: settledResourceAttributes(this._resource) },
            tracers: Array.from(this._tracers.keys()),
            spanProcessors: processors.map(p => p.constructor?.name ?? 'SpanProcessor'),
        };
        return formatInspect('TracerProvider', payload, depth, options, inspect);
    }
}
//# sourceMappingURL=TracerProvider.js.map