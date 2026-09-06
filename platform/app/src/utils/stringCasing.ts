export const camelCaseToTitleCase = (input: string): string => {
  if (typeof input !== "string") {
    return `${input as any}`;
  }
  // Replace camelCase with spaces and capitalize the first letter of each word
  return titleCase(
    input
      // If all caps, make it lowercase first
      .replace(/^[A-Z_\- ]+$/, (str) => str.toLowerCase())
      // Insert a space before all caps
      .replace(/([A-Z])/g, " $1")
      // Replace underscores with spaces
      .replace(/_/g, " "),
  );
};

// Special cases (acronyms etc.)
const accronyms =
  /(\b(llm|rag|gpt|id|ip|iban|vat|pii|url|nrp|us|uk|es|it|pl|sg|au|in|fi|itin|ssn|nhs|nif|nie|nric|uen|abn|acn|tfn|ai|hhem)\b)/gi;

export const titleCase = (input: string): string => {
  return input
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/ (\w)/g, (_, char) => ` ${char.toUpperCase()}`)
    .replace(/openai/gi, "OpenAI")
    .replace(accronyms, (str) => str.toUpperCase());
};

export const uppercaseFirstLetterLowerCaseRest = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/^./, (str) => str.toUpperCase())
    .replace(accronyms, (str) => str.toUpperCase());
};

export const uppercaseFirstLetter = (input: string): string => {
  return input.replace(/^./, (str) => str.toUpperCase());
};

export const camelCaseToLowerCase = (input: string): string =>
  camelCaseToTitleCase(input).toLowerCase();

// https://stackoverflow.com/a/77731548/996404
export const camelCaseToSnakeCase = (input: string): string => {
  return input
    .replace(/(([a-z])(?=[A-Z][a-zA-Z])|([A-Z])(?=[A-Z][a-z]))/g, "$1_")
    .toLowerCase();
};

export const snakeCaseToCamelCase = (input: string): string => {
  return input.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
};

export const camelCaseToPascalCase = (input: string): string => {
  return input.replace(/^([a-z0-9])/, (_, char) => char.toUpperCase());
};

export const snakeCaseToPascalCase = (input: string): string => {
  return camelCaseToPascalCase(snakeCaseToCamelCase(input));
};

export const kebabCase = (input: string): string => {
  return input
    .replace(
      /!|@|#|\$|%|\^|&|\*|\(|\)|_|\+|`|~|:|;|,|\.|\?|\/|\\|\{|\}|\[|\]|\"|\'|\<|\>/g,
      "",
    )
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/ /g, "-")
    .toLowerCase();
};

export const snakeCase = (input: string): string => {
  return input
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/ /g, "_")
    .toLowerCase();
};
