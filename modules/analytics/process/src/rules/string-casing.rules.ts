export const snakeCase = (input: string): string => {
  return input
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/ /g, "_")
    .toLowerCase();
};
