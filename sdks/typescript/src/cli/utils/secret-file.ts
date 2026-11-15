import * as fs from "node:fs";

/** Owner read and write only: what any file holding a key or token is written as. */
const SECRET_FILE_MODE = 0o600;

/**
 * Write a file holding a key or token, owner-only. `mode` applies only on create, so an existing
 * file is narrowed BEFORE the write and the content never sits world-readable. A file system
 * that refuses chmod (some network or Windows mounts) gets a warning, never a lost write.
 */
export function writeSecretFile(
  filePath: string,
  content: string,
  warn: (message: string) => void = defaultWarn,
): void {
  if (fs.existsSync(filePath)) narrow(filePath, warn);
  fs.writeFileSync(filePath, content, { mode: SECRET_FILE_MODE });
  narrow(filePath, warn);
}

function narrow(filePath: string, warn: (message: string) => void): void {
  try {
    fs.chmodSync(filePath, SECRET_FILE_MODE);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(`langwatch: could not make ${filePath} private to you (${reason}); it holds a key.`);
  }
}

function defaultWarn(message: string): void {
  process.stderr.write(`${message}\n`);
}
