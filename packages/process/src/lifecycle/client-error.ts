import type { Duplex } from "node:stream";

/** Request lines whose value is a credential: logged by name only. */
const SECRET_HEADER = /^(cookie|authorization|proxy-authorization|x-auth-token|x-api-key)\s*:/i;
/** How much of a refused request the log line keeps. */
const HEAD_CHARS = 400;
/** The one line either door writes for a request it could not parse. */
export const REFUSED_BEFORE_ROUTING = "http request refused before routing";

/** Errors a closing peer causes; Node's own handler drops them without a word, and so do we. */
export const QUIET_CLIENT_ERROR_CODES: readonly string[] = ["ECONNRESET", "EPIPE"];
const QUIET_CODES = new Set(QUIET_CLIENT_ERROR_CODES);

/** Node's default answer for each parse failure it names, so taking the event changes nothing. */
export const CLIENT_ERROR_STATUS_LINES: Readonly<Record<string, string>> = {
  HPE_HEADER_OVERFLOW: "431 Request Header Fields Too Large",
  HPE_CHUNK_EXTENSIONS_OVERFLOW: "413 Payload Too Large",
  ERR_HTTP_REQUEST_TIMEOUT: "408 Request Timeout",
};

/** The start of a refused request, credential values replaced and control bytes shown. */
export function redactedRequestHead(raw: string): string {
  return raw
    .slice(0, 2048)
    .split("\r\n")
    .map((line) => (SECRET_HEADER.test(line) ? `${line.split(":")[0]}: <redacted>` : line))
    .join("\\r\\n")
    .replace(/[^\x20-\x7e\\]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .slice(0, HEAD_CHARS);
}

/** Whether a client error is worth a log line. */
export function isLoggedClientError(code: string | undefined): boolean {
  return !QUIET_CODES.has(code ?? "");
}

/** Answers a request the parser refused the way Node's default handler would, then closes. */
export function answerClientError({ code, socket }: { code: string | undefined; socket: Duplex }) {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const status = CLIENT_ERROR_STATUS_LINES[code ?? ""] ?? "400 Bad Request";
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}
