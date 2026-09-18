"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.never = void 0;
const Schema_1 = require("../../Schema");
const createIdentitySchemaCreator_1 = require("../../utils/createIdentitySchemaCreator");
exports.never = (0, createIdentitySchemaCreator_1.createIdentitySchemaCreator)(Schema_1.SchemaType.NEVER, (_value, { breadcrumbsPrefix = [] } = {}) => ({
    ok: false,
    errors: [
        {
            path: breadcrumbsPrefix,
            message: "Expected never",
        },
    ],
}));
