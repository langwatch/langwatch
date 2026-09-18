"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lazyObject = lazyObject;
const index_1 = require("../object/index");
const index_2 = require("../object-like/index");
const index_3 = require("../schema-utils/index");
const lazy_1 = require("./lazy");
function lazyObject(getter) {
    const baseSchema = Object.assign(Object.assign({}, (0, lazy_1.constructLazyBaseSchema)(getter)), { _getRawProperties: () => (0, lazy_1.getMemoizedSchema)(getter)._getRawProperties(), _getParsedProperties: () => (0, lazy_1.getMemoizedSchema)(getter)._getParsedProperties() });
    return Object.assign(Object.assign(Object.assign(Object.assign({}, baseSchema), (0, index_3.getSchemaUtils)(baseSchema)), (0, index_2.getObjectLikeUtils)(baseSchema)), (0, index_1.getObjectUtils)(baseSchema));
}
