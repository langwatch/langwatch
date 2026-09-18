/**
 * Converts camelCase or snake_case keys of an object to snake_case recursively.
 */
export function camelOrSnakeToSnakeCase(providerData) {
    if (!providerData ||
        typeof providerData !== 'object' ||
        Array.isArray(providerData)) {
        return providerData;
    }
    const result = {};
    for (const [key, value] of Object.entries(providerData)) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        result[snakeKey] = camelOrSnakeToSnakeCase(value);
    }
    return result;
}
//# sourceMappingURL=providerData.mjs.map