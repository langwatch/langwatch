/**
 * URL string helpers shared by the client SDK services and the CLI.
 *
 * Endpoints reach the SDK from user config, environment variables and CLI
 * flags, so every consumer normalises them before concatenating a path. The
 * trimming here is deliberately loop based rather than a `/\/+$/` regular
 * expression: the regex form is quadratic on adversarial input (a long run of
 * slashes forces the engine to backtrack across the run for every start
 * offset), which is a denial of service vector wherever the string is
 * attacker influenced.
 */

const SLASH_CHAR_CODE = 47;

/**
 * Removes every trailing forward slash from a string in linear time.
 *
 * Behaviourally identical to `input.replace(/\/+$/, "")` for all inputs,
 * including the empty string, a slash-only string (which becomes empty) and
 * protocol-relative URLs, whose leading slashes are never touched because only
 * the tail is scanned.
 */
export function trimTrailingSlashes(input: string): string {
  let end = input.length;

  while (end > 0 && input.charCodeAt(end - 1) === SLASH_CHAR_CODE) {
    end--;
  }

  return end === input.length ? input : input.slice(0, end);
}
