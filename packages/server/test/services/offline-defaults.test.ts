import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execCalls: Array<{
	bin: string;
	args: string[];
	env?: Record<string, string | undefined>;
	timeout?: number;
}> = [];
const spawnedEnvs: Record<string, Record<string, string | undefined>> = {};
let appRootDir = "";

vi.mock("../../src/services/_pipe-to-bus.ts", () => ({
	execAndPipe: vi.fn(
		async (
			_bus: unknown,
			_name: string,
			bin: string,
			args: string[],
			options?: { env?: Record<string, string | undefined>; timeout?: number },
		) => {
			execCalls.push({
				bin,
				args,
				env: options?.env,
				...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
			});
		},
	),
}));

vi.mock("../../src/services/spawn.ts", () => ({
	supervise: vi.fn(
		({
			spec,
		}: {
			spec: { name: string; env: Record<string, string | undefined> };
		}) => {
			spawnedEnvs[spec.name] = spec.env;
			return { name: spec.name, pid: 1, stop: async () => {} };
		},
	),
}));

vi.mock("../../src/services/health.ts", () => ({
	httpGetCheck: () => async () => true,
	pollUntilHealthy: async () => ({ ok: true }),
}));

vi.mock("../../src/services/app-dir.ts", () => ({
	appRoot: () => appRootDir,
}));

vi.mock("../../src/services/node-deps.ts", () => ({
	locateLangwatchDir: () => join(appRootDir, "platform", "app"),
	resolvePnpm: async () => ({ command: "pnpm", args: [] }),
}));

const { startLangwatch } = await import("../../src/services/langwatch.ts");
const { startLangwatchWorkers } = await import(
	"../../src/services/langwatch-workers.ts"
);
const { startLangevals } = await import("../../src/services/langevals.ts");
const { runMigrations } = await import("../../src/services/migrate.ts");
const { ensureTiktokenEncodings, ensureLangevalsTiktokenCache } = await import(
	"../../src/services/offline-defaults.ts"
);

const bus = { emit: () => {} } as never;
let home: string;

function ctx() {
	return {
		ports: {
			langwatch: 5560,
			langevals: 5562,
			postgres: 6560,
			clickhouseHttp: 6562,
		},
		paths: { root: home, bin: join(home, "bin"), logs: join(home, "logs") },
		predeps: {
			uv: { resolvedPath: "/usr/bin/uv", version: "x", preInstalled: false },
		},
		envFile: join(home, ".env"),
		version: "test",
		userEnv: {},
	} as never;
}

const OVERRIDABLE_KEYS = [
	"CHECKPOINT_DISABLE",
	"TIKTOKENS_PATH",
	"RAGAS_DO_NOT_TRACK",
	"LANGWATCH_MODEL_PRICING_DIR",
	"TIKTOKEN_CACHE_DIR",
	"CUSTOM_TIKTOKEN_CACHE_DIR",
];

beforeEach(() => {
	execCalls.length = 0;
	for (const key of Object.keys(spawnedEnvs)) delete spawnedEnvs[key];
	home = mkdtempSync(join(tmpdir(), "lw-offline-"));
	appRootDir = join(home, "app");
	mkdirSync(join(appRootDir, "platform", "app", "node_modules"), {
		recursive: true,
	});
	mkdirSync(join(appRootDir, "services", "langevals"), { recursive: true });
	writeFileSync(
		join(appRootDir, "services", "langevals", "pyproject.toml"),
		"",
	);
	// An ambient export on a dev shell or CI runner would mask the defaults.
	for (const key of OVERRIDABLE_KEYS) delete process.env[key];
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("outbound defaults in the service env", () => {
	describe("when the launcher starts the app, the workers and the migrations", () => {
		/** @scenario The app, the workers and the migrations turn off Prisma's version check */
		it("turns off Prisma's version check in each", async () => {
			await startLangwatch(ctx(), bus, {});
			await startLangwatchWorkers(ctx(), bus, {});
			await runMigrations(ctx(), bus, {});

			expect(spawnedEnvs.langwatch?.CHECKPOINT_DISABLE).toBe("1");
			expect(spawnedEnvs.workers?.CHECKPOINT_DISABLE).toBe("1");
			for (const call of execCalls) {
				expect(call.env?.CHECKPOINT_DISABLE).toBe("1");
			}
			expect(execCalls).toHaveLength(2);
		});

		/** @scenario The app and the workers read tokenizer files from disk */
		it("points the app and the workers at the tokenizer cache", async () => {
			await startLangwatch(ctx(), bus, {});
			await startLangwatchWorkers(ctx(), bus, {});

			const expected = join(home, "cache", "tiktoken-encodings");
			expect(spawnedEnvs.langwatch?.TIKTOKENS_PATH).toBe(expected);
			expect(spawnedEnvs.workers?.TIKTOKENS_PATH).toBe(expected);
		});
	});

	describe("when the launcher starts LangEvals", () => {
		/** @scenario LangEvals prices from the LangWatch catalog and tokenizes from a local cache */
		it("prices from the app catalog, tokenizes from the cache and turns RAGAS analytics off", async () => {
			await startLangevals(ctx(), bus, {});

			const env = spawnedEnvs.langevals;
			expect(env?.LANGWATCH_MODEL_PRICING_DIR).toBe(
				join(appRootDir, "platform", "app", "src", "server", "modelProviders"),
			);
			expect(env?.TIKTOKEN_CACHE_DIR).toBe(join(home, "cache", "tiktoken"));
			expect(env?.CUSTOM_TIKTOKEN_CACHE_DIR).toBe(
				join(home, "cache", "tiktoken"),
			);
			expect(env?.RAGAS_DO_NOT_TRACK).toBe("true");
		});
	});

	describe("when the user's .env sets a value", () => {
		/** @scenario A value in the user's .env overrides a default */
		it("passes the user's value through", async () => {
			const userEnv = {
				TIKTOKENS_PATH: "/srv/tiktoken",
				RAGAS_DO_NOT_TRACK: "false",
			};
			await startLangwatch(ctx(), bus, userEnv);
			await startLangwatchWorkers(ctx(), bus, userEnv);
			await startLangevals(ctx(), bus, userEnv);
			await runMigrations(ctx(), bus, userEnv);

			expect(spawnedEnvs.langwatch?.TIKTOKENS_PATH).toBe("/srv/tiktoken");
			expect(spawnedEnvs.workers?.TIKTOKENS_PATH).toBe("/srv/tiktoken");
			expect(spawnedEnvs.langevals?.RAGAS_DO_NOT_TRACK).toBe("false");
		});

		/** @scenario Prisma's version check stays off whatever the user's .env says */
		it("keeps Prisma's version check off", async () => {
			const userEnv = { CHECKPOINT_DISABLE: "0" };
			await startLangwatch(ctx(), bus, userEnv);
			await startLangwatchWorkers(ctx(), bus, userEnv);
			await runMigrations(ctx(), bus, userEnv);

			expect(spawnedEnvs.langwatch?.CHECKPOINT_DISABLE).toBe("1");
			expect(spawnedEnvs.workers?.CHECKPOINT_DISABLE).toBe("1");
			for (const call of execCalls) {
				expect(call.env?.CHECKPOINT_DISABLE).toBe("1");
			}
		});
	});
});

describe("tokenizer files for the app", () => {
	function fakeApp(files: string[]) {
		const langwatchDir = join(appRootDir, "platform", "app");
		writeFileSync(join(langwatchDir, "package.json"), "{}");
		const tiktoken = join(langwatchDir, "node_modules", "tiktoken");
		mkdirSync(tiktoken, { recursive: true });
		writeFileSync(
			join(tiktoken, "package.json"),
			JSON.stringify({ name: "tiktoken" }),
		);
		writeFileSync(
			join(tiktoken, "registry.json"),
			JSON.stringify(
				Object.fromEntries(
					files.map((file) => [
						file,
						{ load_tiktoken_bpe: `https://example.test/enc/${file}` },
					]),
				),
			),
		);
		return langwatchDir;
	}

	describe("when the cache holds every file the registry names", () => {
		/** @scenario The tokenizer files are downloaded once at install time */
		it("downloads nothing", async () => {
			const langwatchDir = fakeApp(["a.tiktoken", "b.tiktoken"]);
			const cache = join(home, "cache", "tiktoken-encodings");
			mkdirSync(cache, { recursive: true });
			writeFileSync(join(cache, "a.tiktoken"), "x");
			writeFileSync(join(cache, "b.tiktoken"), "x");

			await ensureTiktokenEncodings({ paths: { root: home }, bus, langwatchDir });

			expect(execCalls).toEqual([]);
		});
	});

	describe("when the cache misses a file", () => {
		/** @scenario A missing tokenizer file is downloaded at install time */
		it("runs the app's download script into the cache", async () => {
			const langwatchDir = fakeApp(["a.tiktoken", "b.tiktoken"]);
			const cache = join(home, "cache", "tiktoken-encodings");
			mkdirSync(cache, { recursive: true });
			writeFileSync(join(cache, "a.tiktoken"), "x");

			await ensureTiktokenEncodings({ paths: { root: home }, bus, langwatchDir });

			expect(execCalls).toEqual([
				{
					bin: process.execPath,
					args: [
						join(langwatchDir, "scripts", "download-tiktoken-encodings.mjs"),
						cache,
					],
					env: undefined,
					timeout: 300_000,
				},
			]);
		});
	});
});

describe("tokenizer cache for LangEvals", () => {
	function fill() {
		const lockFile = join(appRootDir, "services", "langevals", "uv.lock");
		writeFileSync(lockFile, "lock-v1");
		return ensureLangevalsTiktokenCache({
			paths: { root: home },
			bus,
			uvBin: "/usr/bin/uv",
			projectDir: join(appRootDir, "services", "langevals"),
			venvDir: join(home, "venvs", "langevals"),
			lockFile,
		});
	}

	describe("when the cache was filled for the current lockfile", () => {
		/** @scenario LangEvals' tokenizer cache is filled once per lockfile */
		it("does not fill it again", async () => {
			await fill();
			expect(execCalls).toHaveLength(1);
			expect(execCalls[0]?.env?.TIKTOKEN_CACHE_DIR).toBe(
				join(home, "cache", "tiktoken"),
			);
			expect(execCalls[0]?.timeout).toBe(300_000);

			await fill();
			expect(execCalls).toHaveLength(1);
		});
	});
});
