export const camelCaseToTitleCase = (input: string): string => {
  // Replace camelCase with spaces and capitalize the first letter of each word
  return titleCase(
    input
      // Insert a space before all caps
      .replace(/([A-Z])/g, " $1")
      // Replace underscores with spaces
      .replace(/_/g, " ")
  );
};

export const titleCase = (input: string): string => {
  return (
    input
      .replace(/^./, (str) => str.toUpperCase())
      .replace(/ (\w)/g, (_, char) => ` ${char.toUpperCase()}`)
      // Special cases (acronyms etc.)
      .replace(/(id|ip|iban|vat|pii)/gi, (str) => str.toUpperCase())
  );
};

export const uppercaseFirstLetterLowerCaseRest = (input: string): string => {
  return (
    input
      .toLowerCase()
      .replace(/^./, (str) => str.toUpperCase())
      // Special cases (acronyms etc.)
      .replace(/(id|ip|iban|vat|pii)/gi, (str) => str.toUpperCase())
  );
};

export const camelCaseToLowerCase = (input: string): string =>
  camelCaseToTitleCase(input).toLowerCase();
