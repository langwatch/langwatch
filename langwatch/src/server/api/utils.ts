export const extractCheckKeys = (inputObject) => {
  const keys = [];

  const recurse = (obj) => {
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
