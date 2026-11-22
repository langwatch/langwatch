/** The product a directory group names, or null when it names only the protocol. */
export function directoryProductName({ source }: { source: string }): string | null {
  const name = source.trim();
  return name === "" || name.toLowerCase() === "scim" ? null : name;
}

/** What the chip on a directory group says: the product, else the directory itself. */
export function directoryChipLabel({ source }: { source: string }): string {
  const product = directoryProductName({ source });
  return product ? product.toUpperCase() : "Directory";
}

/** Why membership is read-only, and that what the group grants is not. */
export function directoryOwnershipCopy({ source }: { source: string }): string {
  const product = directoryProductName({ source });
  const owner = product ? `Your identity provider (${product})` : "Your identity provider";
  return `${owner} owns who is in this group. What this group grants is still yours to change.`;
}
