const getTransformedHeaders = (headers) => {
    const transformedHeaders = {};
    for (const name in headers) {
        const headerValues = headers[name];
        transformedHeaders[name] = Array.isArray(headerValues) ? headerValues.join(",") : headerValues;
    }
    return transformedHeaders;
};
export { getTransformedHeaders };
