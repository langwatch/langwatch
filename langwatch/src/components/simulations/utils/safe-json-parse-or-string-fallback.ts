export const safeJsonParseOrStringFallback = (json: string) => {
  try {
    return JSON.parse(json);
  } catch (e) {
    return {
      data: json,
    };
  }
};
