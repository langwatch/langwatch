/** A cluster name is spliced as an identifier, so only a plain one is trusted. */
export function isPlainClusterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
