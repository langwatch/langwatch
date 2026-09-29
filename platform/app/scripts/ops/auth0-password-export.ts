/**
 * Reading Auth0's password-hash export (ADR-143): which record names which
 * Auth0 user, and which carries a bcrypt hash sign-in can verify. Pure, so
 * the import's whole eligibility decision is testable without a database.
 */

interface Auth0HashValue {
  value?: unknown;
  encoding?: unknown;
}
export interface Auth0ExportRecord {
  user_id?: unknown;
  /** A string, or `{"$oid": ...}` in Auth0's password-hash export. */
  _id?: unknown;
  password_hash?: unknown;
  passwordHash?: unknown;
  custom_password_hash?: unknown;
}

/**
 * A whole bcrypt hash, not just its prefix: `Buffer.from` decodes malformed
 * hex or base64 silently, so a prefix check would pass truncated garbage.
 */
const BCRYPT_SHAPE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const ENCODINGS = new Set(["base64", "hex", "utf8"]);

/**
 * A JSON array or newline-delimited JSON. A line that does not parse is
 * reported by line number only: V8's message quotes the text, which here
 * is a password hash.
 */
export function parseExport(raw: string): Auth0ExportRecord[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Export starts with '[' but is not valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Export starts with '[' but is not a JSON array.");
    }
    return parsed as Auth0ExportRecord[];
  }
  return trimmed.split("\n").flatMap((line, index) => {
    const content = line.trim();
    if (content.length === 0) return [];
    try {
      return [JSON.parse(content) as Auth0ExportRecord];
    } catch {
      throw new Error(`Export line ${index + 1} is not valid JSON.`);
    }
  });
}

function oidOf(id: unknown): unknown {
  return typeof id === "object" && id !== null && "$oid" in id ? id.$oid : id;
}

/** The Auth0 user id; a bare database-connection id gains its `auth0|`. */
export function auth0UserIdOf(record: Auth0ExportRecord): string | null {
  const id = record.user_id ?? oidOf(record._id);
  if (typeof id !== "string" || id.length === 0) return null;
  return id.includes("|") ? id : `auth0|${id}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The bcrypt hash this record carries, or null when it carries none. */
export function bcryptHashOf(record: Auth0ExportRecord): string | null {
  const plain = record.password_hash ?? record.passwordHash;
  if (typeof plain === "string" && BCRYPT_SHAPE.test(plain)) return plain;

  const custom = record.custom_password_hash;
  if (!isObject(custom)) return null;
  if (
    typeof custom.algorithm !== "string" ||
    custom.algorithm.toLowerCase() !== "bcrypt"
  ) {
    return null;
  }
  const hash: Auth0HashValue | null = isObject(custom.hash)
    ? custom.hash
    : null;
  if (typeof hash?.value !== "string") return null;
  const encoding = hash.encoding ?? "utf8";
  if (typeof encoding !== "string" || !ENCODINGS.has(encoding)) return null;
  const decoded =
    encoding === "utf8"
      ? hash.value
      : Buffer.from(hash.value, encoding as BufferEncoding).toString("utf8");
  return BCRYPT_SHAPE.test(decoded) ? decoded : null;
}

/**
 * What an error may say in the operator's terminal: its name and code.
 * Prisma and JSON errors quote their input, and the input is a hash.
 */
export function describeErrorSafely(error: unknown): string {
  if (!(error instanceof Error)) return "non-Error thrown";
  const code =
    "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  return `${error.name}${code}`;
}
