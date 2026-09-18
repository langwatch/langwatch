"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.undiscriminatedUnion = undiscriminatedUnion;
const Schema_1 = require("../../Schema");
const maybeSkipValidation_1 = require("../../utils/maybeSkipValidation");
const index_1 = require("../schema-utils/index");
function undiscriminatedUnion(schemas) {
    const baseSchema = {
        parse: (raw, opts) => {
            return validateAndTransformUndiscriminatedUnion((schema, opts) => schema.parse(raw, opts), schemas, opts);
        },
        json: (parsed, opts) => {
            return validateAndTransformUndiscriminatedUnion((schema, opts) => schema.json(parsed, opts), schemas, opts);
        },
        getType: () => Schema_1.SchemaType.UNDISCRIMINATED_UNION,
    };
    return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
}
function validateAndTransformUndiscriminatedUnion(transform, schemas, opts) {
    const errors = [];
    for (const [index, schema] of schemas.entries()) {
        const transformed = transform(schema, Object.assign(Object.assign({}, opts), { skipValidation: false }));
        if (transformed.ok) {
            return transformed;
        }
        else {
            for (const error of transformed.errors) {
                errors.push({
                    path: error.path,
                    message: `[Variant ${index}] ${error.message}`,
                });
            }
        }
    }
    return {
        ok: false,
        errors,
    };
}
