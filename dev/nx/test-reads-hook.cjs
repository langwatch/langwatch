// Records the paths a cached test run's vitest workers read outside their package, one
// line each, for .github/scripts/check-test-reads.ts (ADR-150). Load it with
// NODE_OPTIONS=--require; it stays inert unless TEST_READS_OUT names a directory.
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const { fileURLToPath } = require("node:url");

const out = process.env.TEST_READS_OUT;
const name = process.env.npm_package_name;
const cachedTarget = ["test", "test:unit"].includes(process.env.npm_lifecycle_event ?? "");
const root = path.resolve(__dirname, "../..");
const packageRoot = process.cwd();
const ignored = /(^|\/)(node_modules|\.nx|\.git)(\/|$)/;

let fd;
let last;

const inWorker = () =>
  process.env.VITEST_WORKER_ID !== undefined || process.env.VITEST_POOL_ID !== undefined;

const toPath = (target) => {
  if (typeof target === "string") return target;
  if (target instanceof URL) return fileURLToPath(target);
  return Buffer.isBuffer(target) ? target.toString() : undefined;
};

const note = ({ target, base = process.cwd() }) => {
  if (!inWorker()) return;
  let absolute;
  try {
    const given = toPath(target);
    if (given === undefined) return;
    absolute = path.resolve(base, given);
  } catch {
    return;
  }
  if (!absolute.startsWith(root + path.sep)) return;
  if (absolute === packageRoot || absolute.startsWith(packageRoot + path.sep)) return;
  const relative = path.relative(root, absolute);
  if (ignored.test(relative) || relative === last) return;
  last = relative;
  if (fd === undefined) {
    fs.mkdirSync(out, { recursive: true });
    fd = fs.openSync(path.join(out, `${name.replace("/", "__")}.${process.pid}.log`), "a");
  }
  fs.writeSync(fd, `${relative}\n`);
};

// A glob reads the directories before its first wildcard, under its cwd.
const noteGlob = ({ pattern, options }) => {
  for (const one of [pattern].flat()) {
    const fixed = String(one).split("/");
    const wild = fixed.findIndex((segment) => /[*?[{]/.test(segment));
    const prefix = (wild === -1 ? fixed : fixed.slice(0, wild)).join("/");
    note({ target: prefix === "" ? "." : prefix, base: options?.cwd ?? process.cwd() });
  }
};

const wrap = ({ owner, method, record }) => {
  const original = owner[method];
  if (typeof original !== "function") return;
  const wrapped = function wrapped(...args) {
    record(args);
    return original.apply(this, args);
  };
  // Keeps util.promisify.custom (fs.exists, exec, execFile) and `.native` working.
  Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
  owner[method] = wrapped;
};

if (out && name && cachedTarget) {
  const reads = ["readFile", "readdir", "stat", "lstat", "opendir", "access"];
  for (const method of [...reads, "exists", "createReadStream"]) {
    wrap({ owner: fs, method, record: ([target]) => note({ target }) });
  }
  for (const method of [...reads, "exists"].map((m) => `${m}Sync`)) {
    wrap({ owner: fs, method, record: ([target]) => note({ target }) });
  }
  for (const method of reads) {
    wrap({ owner: fs.promises, method, record: ([target]) => note({ target }) });
  }
  for (const owner of [fs, fs.promises]) {
    for (const method of ["glob", "globSync"]) {
      wrap({ owner, method, record: ([pattern, options]) => noteGlob({ pattern, options }) });
    }
  }
  // A child process reads its working directory; name it when that lies outside the package.
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    wrap({
      owner: childProcess,
      method,
      record: (args) => {
        const options = args.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
        if (options?.cwd !== undefined) note({ target: options.cwd });
      },
    });
  }
  syncBuiltinESMExports();
}
