/**
 * `agent list` takes no positional argument, so a stray word after
 * `--wait-online` is a name with a space passed bare: the shell split it and
 * commander refused the rest as "too many arguments". That line names the
 * stray word and not the cause, so the hint is added under it. Kept free of
 * imports: `program.ts` wires it statically at boot.
 */
export const QUOTED_NAME_HINT =
  'A name with spaces goes in double quotes: --wait-online "ACME checkout".';

export function withQuotedNameHint(message: string): string {
  if (!/too many arguments/i.test(message)) return message;
  return `${message.trimEnd()}\n${QUOTED_NAME_HINT}\n`;
}
