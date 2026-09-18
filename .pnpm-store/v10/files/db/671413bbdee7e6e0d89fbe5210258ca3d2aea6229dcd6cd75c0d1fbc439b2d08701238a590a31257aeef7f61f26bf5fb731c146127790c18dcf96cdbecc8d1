"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.object = object;
exports.getObjectUtils = getObjectUtils;
const Schema_1 = require("../../Schema");
const entries_1 = require("../../utils/entries");
const filterObject_1 = require("../../utils/filterObject");
const getErrorMessageForIncorrectType_1 = require("../../utils/getErrorMessageForIncorrectType");
const isPlainObject_1 = require("../../utils/isPlainObject");
const keys_1 = require("../../utils/keys");
const maybeSkipValidation_1 = require("../../utils/maybeSkipValidation");
const partition_1 = require("../../utils/partition");
const index_1 = require("../object-like/index");
const index_2 = require("../schema-utils/index");
const property_1 = require("./property");
// eslint-disable-next-line @typescript-eslint/unbound-method
const _hasOwn = Object.prototype.hasOwnProperty;
function object(schemas) {
    // All property metadata is lazily computed on first use.
    // This keeps schema construction free of iteration, which matters when
    // many schemas are defined but only some are exercised at runtime.
    // Required-key computation is also deferred because lazy() schemas may
    // not be resolved at construction time.
    let _rawKeyToProperty;
    function getRawKeyToProperty() {
        if (_rawKeyToProperty == null) {
            _rawKeyToProperty = {};
            for (const [parsedKey, schemaOrObjectProperty] of (0, entries_1.entries)(schemas)) {
                const rawKey = (0, property_1.isProperty)(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.rawKey
                    : parsedKey;
                const valueSchema = (0, property_1.isProperty)(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.valueSchema
                    : schemaOrObjectProperty;
                _rawKeyToProperty[rawKey] = {
                    rawKey,
                    parsedKey: parsedKey,
                    valueSchema,
                };
            }
        }
        return _rawKeyToProperty;
    }
    let _parseRequiredKeys;
    let _jsonRequiredKeys;
    let _parseRequiredKeysSet;
    let _jsonRequiredKeysSet;
    function getParseRequiredKeys() {
        if (_parseRequiredKeys == null) {
            _parseRequiredKeys = [];
            _jsonRequiredKeys = [];
            for (const [parsedKey, schemaOrObjectProperty] of (0, entries_1.entries)(schemas)) {
                const rawKey = (0, property_1.isProperty)(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.rawKey
                    : parsedKey;
                const valueSchema = (0, property_1.isProperty)(schemaOrObjectProperty)
                    ? schemaOrObjectProperty.valueSchema
                    : schemaOrObjectProperty;
                if (isSchemaRequired(valueSchema)) {
                    _parseRequiredKeys.push(rawKey);
                    _jsonRequiredKeys.push(parsedKey);
                }
            }
            _parseRequiredKeysSet = new Set(_parseRequiredKeys);
            _jsonRequiredKeysSet = new Set(_jsonRequiredKeys);
        }
        return _parseRequiredKeys;
    }
    function getJsonRequiredKeys() {
        if (_jsonRequiredKeys == null) {
            getParseRequiredKeys();
        }
        return _jsonRequiredKeys;
    }
    function getParseRequiredKeysSet() {
        if (_parseRequiredKeysSet == null) {
            getParseRequiredKeys();
        }
        return _parseRequiredKeysSet;
    }
    function getJsonRequiredKeysSet() {
        if (_jsonRequiredKeysSet == null) {
            getParseRequiredKeys();
        }
        return _jsonRequiredKeysSet;
    }
    const baseSchema = {
        _getRawProperties: () => Object.entries(schemas).map(([parsedKey, propertySchema]) => (0, property_1.isProperty)(propertySchema) ? propertySchema.rawKey : parsedKey),
        _getParsedProperties: () => (0, keys_1.keys)(schemas),
        parse: (raw, opts) => {
            var _a;
            const breadcrumbsPrefix = (_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : [];
            return validateAndTransformObject({
                value: raw,
                requiredKeys: getParseRequiredKeys(),
                requiredKeysSet: getParseRequiredKeysSet(),
                getProperty: (rawKey) => {
                    const property = getRawKeyToProperty()[rawKey];
                    if (property == null) {
                        return undefined;
                    }
                    return {
                        transformedKey: property.parsedKey,
                        transform: (propertyValue) => {
                            const childBreadcrumbs = [...breadcrumbsPrefix, rawKey];
                            return property.valueSchema.parse(propertyValue, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: childBreadcrumbs }));
                        },
                    };
                },
                unrecognizedObjectKeys: opts === null || opts === void 0 ? void 0 : opts.unrecognizedObjectKeys,
                skipValidation: opts === null || opts === void 0 ? void 0 : opts.skipValidation,
                breadcrumbsPrefix,
                omitUndefined: opts === null || opts === void 0 ? void 0 : opts.omitUndefined,
            });
        },
        json: (parsed, opts) => {
            var _a;
            const breadcrumbsPrefix = (_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : [];
            return validateAndTransformObject({
                value: parsed,
                requiredKeys: getJsonRequiredKeys(),
                requiredKeysSet: getJsonRequiredKeysSet(),
                getProperty: (parsedKey) => {
                    const property = schemas[parsedKey];
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (property == null) {
                        return undefined;
                    }
                    if ((0, property_1.isProperty)(property)) {
                        return {
                            transformedKey: property.rawKey,
                            transform: (propertyValue) => {
                                const childBreadcrumbs = [...breadcrumbsPrefix, parsedKey];
                                return property.valueSchema.json(propertyValue, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: childBreadcrumbs }));
                            },
                        };
                    }
                    else {
                        return {
                            transformedKey: parsedKey,
                            transform: (propertyValue) => {
                                const childBreadcrumbs = [...breadcrumbsPrefix, parsedKey];
                                return property.json(propertyValue, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: childBreadcrumbs }));
                            },
                        };
                    }
                },
                unrecognizedObjectKeys: opts === null || opts === void 0 ? void 0 : opts.unrecognizedObjectKeys,
                skipValidation: opts === null || opts === void 0 ? void 0 : opts.skipValidation,
                breadcrumbsPrefix,
                omitUndefined: opts === null || opts === void 0 ? void 0 : opts.omitUndefined,
            });
        },
        getType: () => Schema_1.SchemaType.OBJECT,
    };
    return Object.assign(Object.assign(Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_2.getSchemaUtils)(baseSchema)), (0, index_1.getObjectLikeUtils)(baseSchema)), getObjectUtils(baseSchema));
}
function validateAndTransformObject({ value, requiredKeys, requiredKeysSet, getProperty, unrecognizedObjectKeys = "fail", skipValidation = false, breadcrumbsPrefix = [], }) {
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
    // Track which required keys have been seen.
    // Use a counter instead of copying the Set to avoid per-call allocation.
    let missingRequiredCount = requiredKeys.length;
    const errors = [];
    const transformed = {};
    for (const preTransformedKey in value) {
        if (!_hasOwn.call(value, preTransformedKey)) {
            continue;
        }
        const preTransformedItemValue = value[preTransformedKey];
        const property = getProperty(preTransformedKey);
        if (property != null) {
            if (missingRequiredCount > 0 && requiredKeysSet.has(preTransformedKey)) {
                missingRequiredCount--;
            }
            const value = property.transform(preTransformedItemValue);
            if (value.ok) {
                transformed[property.transformedKey] = value.value;
            }
            else {
                transformed[preTransformedKey] = preTransformedItemValue;
                errors.push(...value.errors);
            }
        }
        else {
            switch (unrecognizedObjectKeys) {
                case "fail":
                    errors.push({
                        path: [...breadcrumbsPrefix, preTransformedKey],
                        message: `Unexpected key "${preTransformedKey}"`,
                    });
                    break;
                case "strip":
                    break;
                case "passthrough":
                    transformed[preTransformedKey] = preTransformedItemValue;
                    break;
            }
        }
    }
    if (missingRequiredCount > 0) {
        for (const key of requiredKeys) {
            if (!(key in value)) {
                errors.push({
                    path: breadcrumbsPrefix,
                    message: `Missing required key "${key}"`,
                });
            }
        }
    }
    if (errors.length === 0 || skipValidation) {
        return {
            ok: true,
            value: transformed,
        };
    }
    else {
        return {
            ok: false,
            errors,
        };
    }
}
function getObjectUtils(schema) {
    return {
        extend: (extension) => {
            const baseSchema = {
                _getParsedProperties: () => [...schema._getParsedProperties(), ...extension._getParsedProperties()],
                _getRawProperties: () => [...schema._getRawProperties(), ...extension._getRawProperties()],
                parse: (raw, opts) => {
                    return validateAndTransformExtendedObject({
                        extensionKeys: extension._getRawProperties(),
                        value: raw,
                        transformBase: (rawBase) => schema.parse(rawBase, opts),
                        transformExtension: (rawExtension) => extension.parse(rawExtension, opts),
                        breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
                    });
                },
                json: (parsed, opts) => {
                    return validateAndTransformExtendedObject({
                        extensionKeys: extension._getParsedProperties(),
                        value: parsed,
                        transformBase: (parsedBase) => schema.json(parsedBase, opts),
                        transformExtension: (parsedExtension) => extension.json(parsedExtension, opts),
                        breadcrumbsPrefix: opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix,
                    });
                },
                getType: () => Schema_1.SchemaType.OBJECT,
            };
            return Object.assign(Object.assign(Object.assign(Object.assign({}, baseSchema), (0, index_2.getSchemaUtils)(baseSchema)), (0, index_1.getObjectLikeUtils)(baseSchema)), getObjectUtils(baseSchema));
        },
        passthrough: () => {
            const knownRawKeys = new Set(schema._getRawProperties());
            const knownParsedKeys = new Set(schema._getParsedProperties());
            const baseSchema = {
                _getParsedProperties: () => schema._getParsedProperties(),
                _getRawProperties: () => schema._getRawProperties(),
                parse: (raw, opts) => {
                    const transformed = schema.parse(raw, Object.assign(Object.assign({}, opts), { unrecognizedObjectKeys: "passthrough" }));
                    if (!transformed.ok) {
                        return transformed;
                    }
                    const extraProperties = {};
                    if (typeof raw === "object" && raw != null) {
                        for (const [key, value] of Object.entries(raw)) {
                            if (!knownRawKeys.has(key)) {
                                extraProperties[key] = value;
                            }
                        }
                    }
                    return {
                        ok: true,
                        value: Object.assign(Object.assign({}, extraProperties), transformed.value),
                    };
                },
                json: (parsed, opts) => {
                    const transformed = schema.json(parsed, Object.assign(Object.assign({}, opts), { unrecognizedObjectKeys: "passthrough" }));
                    if (!transformed.ok) {
                        return transformed;
                    }
                    const extraProperties = {};
                    if (typeof parsed === "object" && parsed != null) {
                        for (const [key, value] of Object.entries(parsed)) {
                            if (!knownParsedKeys.has(key)) {
                                extraProperties[key] = value;
                            }
                        }
                    }
                    return {
                        ok: true,
                        value: Object.assign(Object.assign({}, extraProperties), transformed.value),
                    };
                },
                getType: () => Schema_1.SchemaType.OBJECT,
            };
            return Object.assign(Object.assign(Object.assign(Object.assign({}, baseSchema), (0, index_2.getSchemaUtils)(baseSchema)), (0, index_1.getObjectLikeUtils)(baseSchema)), getObjectUtils(baseSchema));
        },
    };
}
function validateAndTransformExtendedObject({ extensionKeys, value, transformBase, transformExtension, breadcrumbsPrefix = [], }) {
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
    const extensionPropertiesSet = new Set(extensionKeys);
    const [extensionProperties, baseProperties] = (0, partition_1.partition)((0, keys_1.keys)(value), (key) => extensionPropertiesSet.has(key));
    const transformedBase = transformBase((0, filterObject_1.filterObject)(value, baseProperties));
    const transformedExtension = transformExtension((0, filterObject_1.filterObject)(value, extensionProperties));
    if (transformedBase.ok && transformedExtension.ok) {
        return {
            ok: true,
            value: Object.assign(Object.assign({}, transformedBase.value), transformedExtension.value),
        };
    }
    else {
        return {
            ok: false,
            errors: [
                ...(transformedBase.ok ? [] : transformedBase.errors),
                ...(transformedExtension.ok ? [] : transformedExtension.errors),
            ],
        };
    }
}
function isSchemaRequired(schema) {
    return !isSchemaOptional(schema);
}
function isSchemaOptional(schema) {
    switch (schema.getType()) {
        case Schema_1.SchemaType.ANY:
        case Schema_1.SchemaType.UNKNOWN:
        case Schema_1.SchemaType.OPTIONAL:
        case Schema_1.SchemaType.OPTIONAL_NULLABLE:
            return true;
        default:
            return false;
    }
}
