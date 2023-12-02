export const camelCaseToTitleCase = (input: string): string => {
  // Replace camelCase with spaces and capitalize the first letter of each word
  return (
    input
      // Insert a space before all caps
      .replace(/([A-Z])/g, " $1")
      // Replace underscores with spaces
      .replace(/_/g, " ")
      // Capitalize the first letter of each word
      .replace(/^./, (str) => str.toUpperCase())
      .replace(/ (\w)/g, (_, char) => ` ${char.toUpperCase()}`)
      .replace(/(ip|iban|vat|pii)/gi, (str) => str.toUpperCase())
  );
};

export const camelCaseToLowerCase = (input: string): string =>
  camelCaseToTitleCase(input).toLowerCase();
