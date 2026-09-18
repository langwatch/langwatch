"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bigint = bigint;
const Schema_1 = require("../../Schema");
const getErrorMessageForIncorrectType_1 = require("../../utils/getErrorMessageForIncorrectType");
const maybeSkipValidation_1 = require("../../utils/maybeSkipValidation");
const index_1 = require("../schema-utils/index");
function bigint() {
    const baseSchema = {
        parse: (raw, { breadcrumbsPrefix = [] } = {}) => {
            if (typeof raw === "bigint") {
                return {
                    ok: true,
                    value: raw,
                };
            }
            if (typeof raw === "number") {
                return {
                    ok: true,
                    value: BigInt(raw),
                };
            }
            return {
                ok: false,
                errors: [
                    {
                        path: breadcrumbsPrefix,
                        message: (0, getErrorMessageForIncorrectType_1.getErrorMessageForIncorrectType)(raw, "bigint | number"),
                    },
                ],
            };
        },
        json: (bigint, { breadcrumbsPrefix = [] } = {}) => {
            if (typeof bigint !== "bigint") {
                return {
                    ok: false,
                    errors: [
                        {
                            path: breadcrumbsPrefix,
                            message: (0, getErrorMessageForIncorrectType_1.getErrorMessageForIncorrectType)(bigint, "bigint"),
                        },
                    ],
                };
            }
            return {
                ok: true,
                value: bigint,
            };
        },
        getType: () => Schema_1.SchemaType.BIGINT,
    };
    return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
}
