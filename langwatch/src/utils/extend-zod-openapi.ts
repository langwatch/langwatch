import {
  ZodArray,
  ZodRecord,
  ZodBoolean,
  ZodNumber,
  ZodString,
  ZodObject,
  ZodEnum,
  ZodUnion,
} from "zod";
import "zod-openapi/extend";

export const patchZodOpenapi = () => {
  // Fix for zod-openapi/extend because for some reason it actually doesn't patch when executing the route by next.js, but it does work when generating the openapi schemas directly
  if (!ZodArray.prototype.openapi) {
    ZodArray.prototype.openapi = function () {
      return this;
    };

    ZodObject.prototype.openapi = function () {
      return this;
    };

    ZodString.prototype.openapi = function () {
      return this;
    };

    ZodNumber.prototype.openapi = function () {
      return this;
    };

    ZodBoolean.prototype.openapi = function () {
      return this;
    };

    ZodRecord.prototype.openapi = function () {
      return this;
    };

    ZodEnum.prototype.openapi = function () {
      return this;
    };

    ZodUnion.prototype.openapi = function () {
      return this;
    };
  }
};
