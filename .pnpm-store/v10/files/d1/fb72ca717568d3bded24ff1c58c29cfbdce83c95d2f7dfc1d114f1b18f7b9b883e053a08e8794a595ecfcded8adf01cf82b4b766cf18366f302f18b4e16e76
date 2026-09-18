"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
exports.partialRecord = partialRecord;
const Schema_1 = require("../../Schema");
const getErrorMessageForIncorrectType_1 = require("../../utils/getErrorMessageForIncorrectType");
const isPlainObject_1 = require("../../utils/isPlainObject");
const maybeSkipValidation_1 = require("../../utils/maybeSkipValidation");
const index_1 = require("../schema-utils/index");
// eslint-disable-next-line @typescript-eslint/unbound-method
const _hasOwn = Object.prototype.hasOwnProperty;
function record(keySchema, valueSchema) {
    const baseSchema = {
        parse: (raw, opts) => {
            return validateAndTransformRecord({
                value: raw,
                isKeyNumeric: keySchema.getType() === Schema_1.SchemaType.NUMBER,
                transformKey: (key) => {
                    var _a;
                    return keySchema.parse(key, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key} (key)`] }));
                },
                transformValue: (value, key) => {
                    var _a;
                    return valueSchema.parse(value, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key}`] }));
                },
                breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
            });
        },
        json: (parsed, opts) => {
            return validateAndTransformRecord({
                value: parsed,
                isKeyNumeric: keySchema.getType() === Schema_1.SchemaType.NUMBER,
                transformKey: (key) => {
                    var _a;
                    return keySchema.json(key, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key} (key)`] }));
                },
                transformValue: (value, key) => {
                    var _a;
                    return valueSchema.json(value, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key}`] }));
                },
                breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
            });
        },
        getType: () => Schema_1.SchemaType.RECORD,
    };
    return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
}
function partialRecord(keySchema, valueSchema) {
    const baseSchema = {
        parse: (raw, opts) => {
            return validateAndTransformRecord({
                value: raw,
                isKeyNumeric: keySchema.getType() === Schema_1.SchemaType.NUMBER,
                transformKey: (key) => {
                    var _a;
                    return keySchema.parse(key, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key} (key)`] }));
                },
                transformValue: (value, key) => {
                    var _a;
                    return valueSchema.parse(value, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key}`] }));
                },
                breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
            });
        },
        json: (parsed, opts) => {
            return validateAndTransformRecord({
                value: parsed,
                isKeyNumeric: keySchema.getType() === Schema_1.SchemaType.NUMBER,
                transformKey: (key) => {
                    var _a;
                    return keySchema.json(key, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key} (key)`] }));
                },
                transformValue: (value, key) => {
                    var _a;
                    return valueSchema.json(value, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `${key}`] }));
                },
                breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
            });
        },
        getType: () => Schema_1.SchemaType.RECORD,
    };
    return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
}
function validateAndTransformRecord({ value, isKeyNumeric, transformKey, transformValue, breadcrumbsPrefix = [], }) {
    if (!(0, isPlainObject_1.isPlainObject)(value)) {
        return {
            ok: false,
            errors: [
                {
                    path: breadcrumbsPrefix,
                    message: (0, getErrorMessageForIncorrectType_1.getErrorMessageForIncorrectType)(value, "object"),
                },
            ],
        };
    }
    const result = {};
    const errors = [];
    for (const stringKey in value) {
        if (!_hasOwn.call(value, stringKey)) {
            continue;
        }
        const entryValue = value[stringKey];
        if (entryValue === undefined) {
            continue;
        }
        let key = stringKey;
        if (isKeyNumeric) {
            const numberKey = stringKey.length > 0 ? Number(stringKey) : NaN;
            if (!Number.isNaN(numberKey)) {
                key = numberKey;
            }
        }
        const transformedKey = transformKey(key);
        const transformedValue = transformValue(entryValue, key);
        if (transformedKey.ok && transformedValue.ok) {
            result[transformedKey.value] = transformedValue.value;
        }
        else {
            if (!transformedKey.ok) {
                errors.push(...transformedKey.errors);
            }
            if (!transformedValue.ok) {
                errors.push(...transformedValue.errors);
            }
        }
    }
    if (errors.length === 0) {
        return { ok: true, value: result };
    }
    return { ok: false, errors };
}
