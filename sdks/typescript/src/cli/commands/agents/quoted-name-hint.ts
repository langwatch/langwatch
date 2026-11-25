/**
 * A stray word after `--wait-online` is a name with a space passed bare.
 * Import-free: `program.ts` wires it statically at boot.
 */
export const QUOTED_NAME_HINT =
  'A name with spaces goes in double quotes: --wait-online "ACME checkout".';

export function withQuotedNameHint(message: string): string {
  if (!/too many arguments/i.test(message)) return message;
  return `${message.trimEnd()}\n${QUOTED_NAME_HINT}\n`;
}
