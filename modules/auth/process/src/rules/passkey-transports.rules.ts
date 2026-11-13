/** The plugin's comma-joined transports column, as the list WebAuthn names them in. */
export function transportsOf(value: string | null | undefined): string[] {
  return (value ?? "").split(",").filter((transport) => transport.length > 0);
}
