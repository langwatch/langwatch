export const isJson = (input: string) => {
  if (
    typeof input !== "string" ||
    (!input.trim().startsWith("{") &&
      !input.trim().startsWith("["))
  ) {
    return false;
  }
  try {
    JSON.parse(input);
    return true;
  } catch (e) {
    return false;
  }
};
