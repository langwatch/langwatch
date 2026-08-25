export function generateUniqueIdentifier({
  baseName,
  existingIdentifiers,
}: {
  baseName: string;
  existingIdentifiers: string[];
}): string {
  let counter = 1;
  let identifier = baseName;
  while (existingIdentifiers.includes(identifier))
    identifier = `${baseName}_${counter++}`;
  return identifier;
}
