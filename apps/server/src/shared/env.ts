import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PortAllocation } from "./ports.ts";

export type EnvOverrides = Partial<Record<string, string>>;

export type EnvScaffoldInput = {
	ports: PortAllocation;
	baseHost?: string;
	overrides?: EnvOverrides;
};

// Keys whose generated value MUST be stable across .env regenerations —
// they encrypt rows in postgres (CREDENTIALS_SECRET), sign session/JWT
// cookies (NEXTAUTH_SECRET, API_TOKEN_JWT_SECRET), and re-keying them
// orphans every encrypted ModelProvider key + invalidates every active
// session. We persist these to a sidecar `secrets.json` next to the .env
// on first scaffold, and re-use them on subsequent scaffolds (e.g. user
// `rm`s the .env to start clean but kept `data/postgres/`).
//
// We also persist gateway secrets (LW_VIRTUAL_KEY_PEPPER, LW_GATEWAY_*)
// because rotating the gateway pepper invalidates every issued virtual
// key.
const PERSISTENT_SECRET_KEYS = [
	"NEXTAUTH_SECRET",
	"CREDENTIALS_SECRET",
	"API_TOKEN_JWT_SECRET",
	"LW_VIRTUAL_KEY_PEPPER",
	"LW_GATEWAY_INTERNAL_SECRET",
	"LW_GATEWAY_JWT_SECRET",
	// The app and the Langy agent authenticate to each other with this; a
	// regenerated value on one side and not the other makes every turn 401.
	"LANGY_INTERNAL_SECRET",
] as const;

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const b64 = (bytes: number) => randomBytes(bytes).toString("base64");

type PortBoundEnvEntry = {
	/** The value the current port allocation calls for. */
	expected: string;
	/**
	 * What a scaffold-written value looks like for ANY port base. Reconcile
	 * only rewrites a value that still matches this shape: a user who pointed
	 * the key somewhere else on purpose (a LAN hostname, an external store)
	 * never matches, so their edit survives every port shift.
	 */
	scaffoldShape: RegExp;
};

const LOCALHOST_URL_SHAPE = /^http:\/\/localhost:\d+$/;

/**
 * Every .env key whose value embeds an allocated port, with the value the
 * given allocation expects. buildEnv writes these on first scaffold and
 * reconcileEnvFile rewrites them when a later run lands on a different port
 * base (a stray process on one port of the old slot is enough) — without
 * this, the .env keeps the old slot's URLs and the app dials data stores
 * that this very run started somewhere else.
 */
export function portBoundEnv(ports: PortAllocation) {
	const host = `http://localhost:${ports.langwatch}`;
	return {
		BASE_HOST: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
		NEXTAUTH_URL: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
		PORT: { expected: String(ports.langwatch), scaffoldShape: /^\d+$/ },
		DATABASE_URL: {
			expected: `postgresql://langwatch@localhost:${ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`,
			scaffoldShape:
				/^postgresql:\/\/langwatch@localhost:\d+\/langwatch_db\?schema=langwatch_db&connection_limit=5$/,
		},
		REDIS_URL: {
			expected: `redis://localhost:${ports.redis}/0`,
			scaffoldShape: /^redis:\/\/localhost:\d+\/0$/,
		},
		CLICKHOUSE_URL: {
			expected: `http://localhost:${ports.clickhouseHttp}/langwatch`,
			scaffoldShape: /^http:\/\/localhost:\d+\/langwatch$/,
		},
		LANGWATCH_NLP_SERVICE: {
			expected: `http://localhost:${ports.nlp}`,
			scaffoldShape: LOCALHOST_URL_SHAPE,
		},
		LANGEVALS_ENDPOINT: {
			expected: `http://localhost:${ports.langevals}`,
			scaffoldShape: LOCALHOST_URL_SHAPE,
		},
		LANGWATCH_ENDPOINT: { expected: host, scaffoldShape: LOCALHOST_URL_SHAPE },
		LW_GATEWAY_BASE_URL: {
			expected: `http://localhost:${ports.aigateway}`,
			scaffoldShape: LOCALHOST_URL_SHAPE,
		},
		OPENCODE_AGENT_URL: {
			expected: `http://localhost:${ports.langyagent}`,
			scaffoldShape: LOCALHOST_URL_SHAPE,
		},
	} satisfies Record<string, PortBoundEnvEntry>;
}

/**
 * Builds the .env body for ~/.langwatch/.env. Mirrors the helm chart's
 * "basic" preset: every secret that the app refuses to start without is
 * generated locally; every optional integration (OpenAI, Sendgrid, …) is
 * left blank for the user to fill in later. Every URL is keyed off the
 * allocated port table so a `--port-base 5570` shift cascades to every
 * service consistently.
 */
export function buildEnv({
	ports,
	baseHost,
	overrides = {},
}: EnvScaffoldInput): string {
	const host = baseHost ?? `http://localhost:${ports.langwatch}`;
	const portBound = portBoundEnv(ports);
	const lines: string[] = [];
	const set = (key: string, value: string) => {
		lines.push(`${key}=${value}`);
	};
	const sectionBreak = (title: string) => {
		lines.push("", `# ${title}`);
	};

	sectionBreak("BASIC CONFIGURATION");
	set("NODE_ENV", "production");
	set("BASE_HOST", host);
	set("NEXTAUTH_URL", host);
	set("PORT", portBound.PORT.expected);
	set("DEBUG", "langwatch:*");

	sectionBreak("AUTHENTICATION");
	set("NEXTAUTH_PROVIDER", "email");
	set("NEXTAUTH_SECRET", b64(32));
	set("CREDENTIALS_SECRET", hex(32));
	set("API_TOKEN_JWT_SECRET", hex(32));

	sectionBreak("DATA STORES (provisioned locally by @langwatch/server)");
	set("DATABASE_URL", portBound.DATABASE_URL.expected);
	set("REDIS_URL", portBound.REDIS_URL.expected);
	set("CLICKHOUSE_URL", portBound.CLICKHOUSE_URL.expected);

	sectionBreak("LANGWATCH INTERNAL SERVICES");
	set("LANGWATCH_NLP_SERVICE", portBound.LANGWATCH_NLP_SERVICE.expected);
	set("LANGEVALS_ENDPOINT", portBound.LANGEVALS_ENDPOINT.expected);
	// The engine reads `LANGWATCH_ENDPOINT` to decide where to POST evaluator
	// runs and dataset uploads. The default is https://app.langwatch.ai
	// (cloud) — which is wrong for self-host: callbacks then 401 against the
	// hosted API, evaluators produce no scores, and the experiments workbench
	// just shows the evaluator title with no value. Pinning to our local
	// langwatch app routes those callbacks to the running stack.
	set("LANGWATCH_ENDPOINT", host);

	sectionBreak("AI GATEWAY");
	set("LW_VIRTUAL_KEY_PEPPER", hex(32));
	set("LW_GATEWAY_INTERNAL_SECRET", hex(32));
	set("LW_GATEWAY_JWT_SECRET", hex(32));
	// Where the gateway is, from the app's point of view. The gateway process
	// reads this same name to mean the opposite direction (where the CONTROL
	// PLANE is) and services/aigateway.ts sets it explicitly in that child's
	// env, so this value only ever reaches the app — which uses it to hand
	// Langy's workers, and CLI users, an OpenAI-compatible base URL. Pointed at
	// the app itself, every one of those callers dialled a server with no /v1
	// surface.
	set("LW_GATEWAY_BASE_URL", portBound.LW_GATEWAY_BASE_URL.expected);

	sectionBreak("LANGY ASSISTANT");
	// Shared bearer between the app and the agent; see PERSISTENT_SECRET_KEYS.
	set("LANGY_INTERNAL_SECRET", hex(32));
	set("OPENCODE_AGENT_URL", portBound.OPENCODE_AGENT_URL.expected);
	// Langy's rollout flag is SYSTEM-scoped and defaults off so the hosted
	// product can open it one cohort at a time. A laptop install is a cohort of
	// one, and it just installed the assistant on purpose.
	set("FEATURE_FLAG_FORCE_ENABLE", "release_langy_enabled");

	sectionBreak("OPTIONAL PIECES — flip one of these and restart the server");
	// These are read by the installer AND by the app, so the same line decides
	// what gets downloaded and what the product says about it.
	set("LANGWATCH_ENABLE_LANGY", "true");
	// The PII detection evaluator ships a ~670MB language model — larger than
	// the rest of the evaluator environment put together. Off by default; the
	// product points anyone who reaches for that evaluator back at this line.
	set("LANGWATCH_ENABLE_PRESIDIO", "false");
	// The language detection evaluator: ~95MB of language models, same deal.
	set("LANGWATCH_ENABLE_LINGUA", "false");

	sectionBreak("ENVIRONMENT");
	set("ENVIRONMENT", "local");

	sectionBreak("MODELS — fill in any provider you want to evaluate against");
	set("OPENAI_API_KEY", "");
	set("ANTHROPIC_API_KEY", "");
	set("AZURE_OPENAI_ENDPOINT", "");
	set("AZURE_OPENAI_API_KEY", "");
	set("GROQ_API_KEY", "");

	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) continue;
		const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
		if (idx >= 0) lines[idx] = `${key}=${value}`;
		else set(key, value);
	}

	return lines.join("\n") + "\n";
}

/**
 * The env-file scaffolder both the CLI's [2/4] env phase and
 * services/runtime.ts's `scaffoldEnv` call into. Idempotent — once a
 * .env has been written it's never overwritten so the user's edits
 * (e.g. OPENAI_API_KEY) survive across runs.
 *
 * The list of passthrough keys (OPENAI_API_KEY etc.) is intentionally
 * NOT honoured here — those propagate via RuntimeContext.userEnv so the
 * .env file stays free of user secrets. See 04-validation.feature.
 */
export function scaffoldEnvFile(
	input: EnvScaffoldInput & { path: string; shouldReconcilePorts?: boolean },
): { written: boolean; path: string; reconciledKeys: string[] } {
	const secretsPath = join(dirname(input.path), "secrets.json");

	if (existsSync(input.path)) {
		// .env already exists. Backfill secrets.json from it if the sidecar
		// hasn't been written yet — this covers users upgrading from a prior
		// beta that didn't ship the secret-persistence path. Without this,
		// their existing CREDENTIALS_SECRET stays in the .env but the
		// sidecar is empty, so the next `rm ~/.langwatch/.env` rotates the
		// secret and orphans encrypted ModelProvider rows.
		if (!existsSync(secretsPath)) {
			writePersistedSecrets(secretsPath, readFileSync(input.path, "utf8"));
		}
		// The file stays the user's — except the port-bound URLs, which belong
		// to whatever allocation THIS run got. A run that auto-shifted (one
		// stray process on the old slot is enough) otherwise boots services on
		// the new slot while the app reads the old slot's URLs from here and
		// dials data stores that aren't there. Only callers whose ports are a
		// real, conflict-checked allocation ask for this — a default-port guess
		// (the bare `install` command) must not rewrite a shifted install
		// backwards.
		const reconciledKeys = input.shouldReconcilePorts
			? reconcileEnvFile(input)
			: [];
		return { written: false, path: input.path, reconciledKeys };
	}

	mkdirSync(dirname(input.path), { recursive: true });

	// Read previously persisted secrets (from a prior scaffold) and overlay
	// them so a `rm ~/.langwatch/.env; npx ...` doesn't rotate
	// CREDENTIALS_SECRET out from under encrypted postgres rows. The first
	// scaffold writes the sidecar; every later scaffold reuses it.
	const persistedSecrets = readPersistedSecrets(secretsPath);
	const overlay = { ...input.overrides, ...persistedSecrets };

	const body = buildEnv({ ...input, overrides: overlay });
	writeFileSync(input.path, body, { mode: 0o600 });
	writePersistedSecrets(secretsPath, body);
	return { written: true, path: input.path, reconciledKeys: [] };
}

/**
 * Rewrites the port-bound URLs of an existing .env to the given allocation.
 * Only values still in their scaffold shape are touched (see portBoundEnv);
 * anything a user pointed elsewhere is kept, and the rest of the file —
 * secrets, model keys, toggles, comments — is preserved byte for byte.
 * Returns the keys it rewrote.
 */
export function reconcileEnvFile(input: {
	ports: PortAllocation;
	path: string;
}): string[] {
	if (!existsSync(input.path)) return [];
	const entries = portBoundEnv(input.ports);
	const lines = readFileSync(input.path, "utf8").split("\n");
	const reconciledKeys: string[] = [];
	for (const [key, entry] of Object.entries(entries)) {
		const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
		if (idx < 0) continue;
		const value = (lines[idx] as string).slice(key.length + 1);
		if (value === entry.expected) continue;
		if (!entry.scaffoldShape.test(value)) continue;
		lines[idx] = `${key}=${entry.expected}`;
		reconciledKeys.push(key);
	}
	if (reconciledKeys.length > 0) {
		// { mode } on writeFileSync only applies when the OS creates a new
		// file; rewriting an existing one leaves its current permissions
		// untouched. The .env holds secrets, so chmod explicitly rather than
		// trust whatever mode the file already had.
		writeFileSync(input.path, lines.join("\n"), { mode: 0o600 });
		chmodSync(input.path, 0o600);
	}
	return reconciledKeys;
}

function readPersistedSecrets(path: string): Record<string, string> {
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Record<string, string>;
		const out: Record<string, string> = {};
		for (const key of PERSISTENT_SECRET_KEYS) {
			const v = parsed[key];
			if (typeof v === "string" && v.length > 0) out[key] = v;
		}
		return out;
	} catch {
		return {};
	}
}

function writePersistedSecrets(path: string, envBody: string): void {
	const found: Record<string, string> = {};
	for (const line of envBody.split("\n")) {
		const m = line.match(/^([^=]+)=(.*)$/);
		if (!m) continue;
		const [, key, value] = m as unknown as [string, string, string];
		if ((PERSISTENT_SECRET_KEYS as readonly string[]).includes(key)) {
			found[key] = value;
		}
	}
	if (Object.keys(found).length === 0) return;
	writeFileSync(path, JSON.stringify(found, null, 2), { mode: 0o600 });
}

const PASSTHROUGH_ENV_KEYS = [
	"OPENAI_API_KEY",
	"AZURE_OPENAI_ENDPOINT",
	"AZURE_OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GROQ_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"VERTEXAI_PROJECT",
	"VERTEXAI_LOCATION",
	"SENDGRID_API_KEY",
	"SENTRY_DSN",
] as const;

/**
 * Snapshot the user's process.env for the keys we propagate to children.
 * Empty values are dropped so they don't override .env defaults.
 */
export function captureUserEnv(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of PASSTHROUGH_ENV_KEYS) {
		const value = env[key];
		if (value && value.length > 0) out[key] = value;
	}
	return out;
}
