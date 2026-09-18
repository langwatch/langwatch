"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIdentitySchemaCreator = createIdentitySchemaCreator;
const index_1 = require("../builders/schema-utils/index");
const maybeSkipValidation_1 = require("./maybeSkipValidation");
function createIdentitySchemaCreator(schemaType, validate) {
    return () => {
        const baseSchema = {
            parse: validate,
            json: validate,
            getType: () => schemaType,
        };
        return Object.assign(Object.assign({}, (0, maybeSkipValidation_1.maybeSkipValidation)(baseSchema)), (0, index_1.getSchemaUtils)(baseSchema));
    };
}
