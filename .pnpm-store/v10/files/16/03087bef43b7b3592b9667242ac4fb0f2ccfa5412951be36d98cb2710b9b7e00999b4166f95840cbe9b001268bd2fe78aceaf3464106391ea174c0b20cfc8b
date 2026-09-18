import { parseDef } from "../parseDef.mjs";
export const parsePipelineDef = (def, refs, forceResolution) => {
    if (refs.pipeStrategy === 'input') {
        return parseDef(def.in._def, refs, forceResolution);
    }
    else if (refs.pipeStrategy === 'output') {
        return parseDef(def.out._def, refs, forceResolution);
    }
    const a = parseDef(def.in._def, {
        ...refs,
        currentPath: [...refs.currentPath, 'allOf', '0'],
    });
    const b = parseDef(def.out._def, {
        ...refs,
        currentPath: [...refs.currentPath, 'allOf', a ? '1' : '0'],
    });
    return {
        allOf: [a, b].filter((x) => x !== undefined),
    };
};
//# sourceMappingURL=pipeline.mjs.map