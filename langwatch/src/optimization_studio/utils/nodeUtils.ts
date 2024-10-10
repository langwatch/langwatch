export const nameToId = (name: string) => {
  return name
    .toLowerCase()
    .replace(/[\(\)]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
};
