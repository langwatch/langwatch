import { randomUUID } from '@openai/agents-core/_shims';
/**
 * Generate an ISO 8601 timestamp of the current time.
 * @returns An ISO 8601 timestamp.
 */
export function timeIso() {
    return new Date().toISOString();
}
/**
 * Generate a trace ID by creating a random UUID v4 and removing the dashes. This is the equivalent
 * of `uuid4().hex` in Python and prefixing it with `trace_`.
 * @returns A trace ID.
 */
export function generateTraceId() {
    return `trace_${randomUUID().replace(/-/g, '')}`;
}
/**
 * Generate a span ID by creating a random UUID v4 and removing the dashes. This is the equivalent
 * of `uuid4().hex` in Python and prefixing it with `span_`.
 * @returns A span ID.
 */
export function generateSpanId() {
    return `span_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
/**
 * Generate a group ID by creating a random UUID v4 and removing the dashes. This is the equivalent
 * of `uuid4().hex` in Python and prefixing it with `group_`.
 * @returns A group ID.
 */
export function generateGroupId() {
    return `group_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
/**
 * Remove fields that start with an underscore from an object.
 * @param obj - The object to remove private fields from.
 * @returns A new object with private fields removed.
 */
export function removePrivateFields(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => !key.startsWith('_')));
}
//# sourceMappingURL=utils.mjs.map