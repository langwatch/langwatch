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
      .replace(/_/g, " ")
  );
};

// Special cases (acronyms etc.)
const accronyms = /(\b(llm|rag|id|ip|iban|vat|pii|url|nrp|us|es|it|pl|sg|au|in|fi|itin|ssn|nhs|nif|nie|nric|uen|abn|acn|tfn)\b)/gi;

export const titleCase = (input: string): string => {
  return input
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/ (\w)/g, (_, char) => ` ${char.toUpperCase()}`)
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
