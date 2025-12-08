export const safeJsonParseOrStringFallback = (json: string) => {
  try {
    return JSON.parse(json);
  } catch {
    return {
      data: json,
    };
  }
};
