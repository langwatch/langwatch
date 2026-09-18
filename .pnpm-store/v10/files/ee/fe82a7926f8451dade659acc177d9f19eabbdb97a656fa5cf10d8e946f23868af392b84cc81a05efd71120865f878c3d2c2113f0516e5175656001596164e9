import { parseDef } from "../parseDef.mjs";
export function parseDefaultDef(_def, refs, forceResolution) {
    return {
        ...parseDef(_def.innerType._def, refs, forceResolution),
        default: _def.defaultValue(),
    };
}
//# sourceMappingURL=default.mjs.map