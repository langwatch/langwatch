export const isJson = (input: string) => {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  const looksJsonShaped = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJsonShaped) {
    return false;
  }
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
};
