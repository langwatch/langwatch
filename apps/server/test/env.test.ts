import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildEnv,
	reconcileEnvFile,
	scaffoldEnvFile,
} from "../src/shared/env.ts";
import { allocatePorts } from "../src/shared/ports.ts";

describe("buildEnv", () => {
	describe("when given the default port base", () => {
		const env = buildEnv({ ports: allocatePorts(5560) });

		it("targets every URL at the matching port (app tier 5560-3, infra tier 6560-3)", () => {
			expect(env).toContain("BASE_HOST=http://localhost:5560");
			expect(env).toContain(
				"DATABASE_URL=postgresql://langwatch@localhost:6560",
			);
			expect(env).toContain("REDIS_URL=redis://localhost:6561/0");
			expect(env).toContain("CLICKHOUSE_URL=http://localhost:6562/langwatch");
			expect(env).toContain("LANGWATCH_NLP_SERVICE=http://localhost:5561");
			expect(env).toContain("LANGEVALS_ENDPOINT=http://localhost:5562");
			// The gateway's own port, not the app's: this value is what the app
			// hands Langy's workers and CLI users as an OpenAI-compatible base URL.
			// The gateway process reads the same name to mean the opposite direction
			// and gets its value from services/aigateway.ts, not from here.
			expect(env).toContain("LW_GATEWAY_BASE_URL=http://localhost:5563");
			expect(env).toContain("OPENCODE_AGENT_URL=http://localhost:5564");
		});

		it("populates every secret with a fresh random value", () => {
			const env2 = buildEnv({ ports: allocatePorts(5560) });
			const secret = (text: string, key: string) =>
				text
					.split("\n")
					.find((line) => line.startsWith(`${key}=`))
					?.split("=")[1];
			expect(secret(env, "NEXTAUTH_SECRET")).not.toBe(
				secret(env2, "NEXTAUTH_SECRET"),
			);
			expect(secret(env, "CREDENTIALS_SECRET")).toMatch(/^[a-f0-9]{64}$/);
			expect(secret(env, "API_TOKEN_JWT_SECRET")).toMatch(/^[a-f0-9]{64}$/);
			expect(secret(env, "LW_VIRTUAL_KEY_PEPPER")).toMatch(/^[a-f0-9]{64}$/);
			expect(secret(env, "LW_GATEWAY_INTERNAL_SECRET")).toMatch(
				/^[a-f0-9]{64}$/,
			);
			expect(secret(env, "LW_GATEWAY_JWT_SECRET")).toMatch(/^[a-f0-9]{64}$/);
		});

		it("leaves model API keys empty for the user to fill in", () => {
			expect(env).toContain("OPENAI_API_KEY=\n");
			expect(env).toContain("ANTHROPIC_API_KEY=\n");
		});
	});

	describe("when given an override", () => {
		it("replaces the value in place rather than appending a duplicate", () => {
			const env = buildEnv({
				ports: allocatePorts(5560),
				overrides: { OPENAI_API_KEY: "sk-test-123" },
			});
			const lines = env
				.split("\n")
				.filter((l) => l.startsWith("OPENAI_API_KEY="));
			expect(lines).toEqual(["OPENAI_API_KEY=sk-test-123"]);
		});
	});

	describe("when given a custom port base", () => {
		it("shifts every URL to the new slot in lockstep across both tiers", () => {
			const env = buildEnv({ ports: allocatePorts(5610) });
			expect(env).toContain("BASE_HOST=http://localhost:5610");
			expect(env).toContain(
				"DATABASE_URL=postgresql://langwatch@localhost:6610",
			);
			expect(env).toContain("REDIS_URL=redis://localhost:6611/0");
		});
	});

	describe("when scaffolding NLP wiring", () => {
		const env = buildEnv({ ports: allocatePorts(5560) });

		it("points LANGWATCH_NLP_SERVICE at the nlpgo port", () => {
			expect(env).toContain("LANGWATCH_NLP_SERVICE=http://localhost:5561");
		});

		it("does not force the removed Go-engine feature flag (routing is unconditional)", () => {
			expect(env).not.toContain("release_nlp_go_engine_enabled");
			expect(env).not.toContain("LANGWATCH_NPX_NLP");
		});
	});
});

describe("reconcileEnvFile", () => {
	async function scaffoldAt(
		base: number,
	): Promise<{ dir: string; envPath: string }> {
		const dir = await mkdtemp(join(tmpdir(), "langwatch-reconcile-"));
		const envPath = join(dir, ".env");
		scaffoldEnvFile({ ports: allocatePorts(base), path: envPath });
		return { dir, envPath };
	}

	describe("when a later run lands on a different port slot", () => {
		it("rewrites every port-bound URL to the new slot", async () => {
			const { envPath } = await scaffoldAt(5560);
			const reconciled = reconcileEnvFile({
				ports: allocatePorts(5580),
				path: envPath,
			});
			const body = readFileSync(envPath, "utf8");
			expect(reconciled).toContain("REDIS_URL");
			expect(reconciled).toContain("DATABASE_URL");
			expect(body).toContain("REDIS_URL=redis://localhost:6581/0");
			expect(body).toContain(
				"DATABASE_URL=postgresql://langwatch@localhost:6580",
			);
			expect(body).toContain("BASE_HOST=http://localhost:5580");
			expect(body).toContain("OPENCODE_AGENT_URL=http://localhost:5584");
			expect(body).toContain("PORT=5580");
		});

		it("keeps everything that is not a port-bound URL byte for byte", async () => {
			const { envPath } = await scaffoldAt(5560);
			writeFileSync(
				envPath,
				readFileSync(envPath, "utf8").replace(
					"OPENAI_API_KEY=",
					"OPENAI_API_KEY=sk-test-123",
				),
			);
			const before = readFileSync(envPath, "utf8").split("\n");
			const reconciled = reconcileEnvFile({
				ports: allocatePorts(5580),
				path: envPath,
			});
			const after = readFileSync(envPath, "utf8").split("\n");
			// Same line count, same order, and every line that differs is one
			// of the keys reconcile reported — nothing else moved at all.
			expect(after).toHaveLength(before.length);
			for (let i = 0; i < before.length; i++) {
				if (before[i] === after[i]) continue;
				expect(reconciled).toContain((before[i] ?? "").split("=")[0]);
			}
			expect(after).toContain("OPENAI_API_KEY=sk-test-123");
		});

		it("is a no-op when the allocation already matches", async () => {
			const { envPath } = await scaffoldAt(5560);
			const before = readFileSync(envPath, "utf8");
			const reconciled = reconcileEnvFile({
				ports: allocatePorts(5560),
				path: envPath,
			});
			expect(reconciled).toEqual([]);
			expect(readFileSync(envPath, "utf8")).toBe(before);
		});
	});

	describe("when the user pointed a URL somewhere else on purpose", () => {
		it("keeps the user's value and only updates the still-scaffold-shaped ones", async () => {
			const { envPath } = await scaffoldAt(5560);
			const custom = readFileSync(envPath, "utf8").replace(
				"BASE_HOST=http://localhost:5560",
				"BASE_HOST=https://langwatch.lan.example",
			);
			writeFileSync(envPath, custom);
			const reconciled = reconcileEnvFile({
				ports: allocatePorts(5580),
				path: envPath,
			});
			const body = readFileSync(envPath, "utf8");
			expect(body).toContain("BASE_HOST=https://langwatch.lan.example");
			expect(reconciled).not.toContain("BASE_HOST");
			expect(body).toContain("REDIS_URL=redis://localhost:6581/0");
		});
	});

	describe("when scaffoldEnvFile runs over an existing file", () => {
		it("reconciles only when asked to (a default-port guess must not rewrite a shifted install)", async () => {
			const { envPath } = await scaffoldAt(5580);
			const untouched = scaffoldEnvFile({
				ports: allocatePorts(5560),
				path: envPath,
			});
			expect(untouched.reconciledKeys).toEqual([]);
			expect(readFileSync(envPath, "utf8")).toContain(
				"REDIS_URL=redis://localhost:6581/0",
			);

			const asked = scaffoldEnvFile({
				ports: allocatePorts(5560),
				path: envPath,
				shouldReconcilePorts: true,
			});
			expect(asked.reconciledKeys).toContain("REDIS_URL");
			expect(readFileSync(envPath, "utf8")).toContain(
				"REDIS_URL=redis://localhost:6561/0",
			);
		});
	});

	describe("when the existing file has looser permissions than 0600", () => {
		it("tightens them back down on rewrite, since the file holds secrets", async () => {
			const { envPath } = await scaffoldAt(5560);
			chmodSync(envPath, 0o644);
			reconcileEnvFile({ ports: allocatePorts(5580), path: envPath });
			const mode = statSync(envPath).mode & 0o777;
			expect(mode).toBe(0o600);
		});
	});
});
