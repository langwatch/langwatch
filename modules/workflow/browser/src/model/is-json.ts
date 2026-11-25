export const isJson = (input: string) => {
  const trimmed = typeof input === "string" ? input.trim() : "";
  const opensAsObjectOrArray = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!opensAsObjectOrArray) {
    return false;
  }
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
};
