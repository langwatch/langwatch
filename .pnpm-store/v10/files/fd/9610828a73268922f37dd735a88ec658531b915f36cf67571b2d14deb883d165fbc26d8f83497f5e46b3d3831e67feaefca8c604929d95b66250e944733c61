"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
const Schema_1 = require("../../Schema");
const getErrorMessageForIncorrectType_1 = require("../../utils/getErrorMessageForIncorrectType");
const maybeSkipValidation_1 = require("../../utils/maybeSkipValidation");
const index_1 = require("../schema-utils/index");
function list(schema) {
    const baseSchema = {
        parse: (raw, opts) => validateAndTransformArray(raw, (item, index) => {
            var _a;
            return schema.parse(item, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `[${index}]`] }));
        }),
        json: (parsed, opts) => validateAndTransformArray(parsed, (item, index) => {
            var _a;
            return schema.json(item, Object.assign(Object.assign({}, opts), { breadcrumbsPrefix: [...((_a = opts === null || opts === void 0 ? void 0 : opts.breadcrumbsPrefix) !== null && _a !== void 0 ? _a : []), `[${index}]`] }));
        }),
        getType: () => Schema_1.SchemaType.LIST,
    };
    return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
}
function validateAndTransformArray(value, transformItem) {
    if (!Array.isArray(value)) {
        return {
            ok: false,
            errors: [
                {
                    message: (0, getErrorMessageForIncorrectType_1.getErrorMessageForIncorrectType)(value, "list"),
                    path: [],
                },
            ],
        };
    }
    const result = [];
    const errors = [];
    for (let i = 0; i < value.length; i++) {
        const item = transformItem(value[i], i);
        if (item.ok) {
            result.push(item.value);
        }
        else {
            errors.push(...item.errors);
        }
    }
    if (errors.length === 0) {
        return { ok: true, value: result };
    }
    return { ok: false, errors };
}
