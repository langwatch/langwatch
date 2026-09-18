export function asZodType(schema) {
    return schema;
}
export function readZodDefinition(input) {
    if (typeof input !== 'object' || input === null) {
        return undefined;
    }
    const candidate = input;
    return candidate._zod?.def || candidate._def || candidate.def;
}
export function readZodType(input) {
    const def = readZodDefinition(input);
    if (!def) {
        return undefined;
    }
    const rawType = (typeof def.typeName === 'string' && def.typeName) ||
        (typeof def.type === 'string' && def.type);
    if (typeof rawType !== 'string') {
        return undefined;
    }
    const lower = rawType.toLowerCase();
    return lower.startsWith('zod') ? lower.slice(3) : lower;
}
//# sourceMappingURL=zodCompat.mjs.map