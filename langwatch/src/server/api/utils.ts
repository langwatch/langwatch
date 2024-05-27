export const extractCheckKeys = (
  inputObject: Record<string, any>
): string[] => {
  const keys: string[] = [];

  const recurse = (obj: Record<string, any>) => {
    for (const key in obj) {
      if (key.startsWith("check_")) {
        keys.push(key);
      }
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        recurse(obj[key]);
      }
    }
  };

  recurse(inputObject);
  return keys;
};
