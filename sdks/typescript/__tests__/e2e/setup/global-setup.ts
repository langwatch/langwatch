/**
 * Resolves the stack every SDK and CLI end-to-end file runs against.
 */
import { execFileSync } from "node:child_process";
import { REPO_ROOT, seededProject, startStack, type RunningStack } from "@langwatch/e2e-stack";

import { writeStackHandoff } from "./stack-handoff";
import { loadWorkspaceEnv } from "./workspace-env";

const STACK_PORT = Number(process.env.E2E_STACK_PORT ?? "5610");

/**
 * A stack already answering is only reused when it is this machine's. A
 * `LANGWATCH_ENDPOINT` left pointing at a hosted platform must never become
 * the thing an end-to-end suite writes to.
 */
function localHint(): string | undefined {
  const named = process.env.LANGWATCH_ENDPOINT;
  if (!named) return undefined;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(named) ? named : undefined;
}

async function keyIsAccepted(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/prompts`, {
      headers: { authorization: `Bearer ${apiKey}`, "x-auth-token": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    return response.status < 400;
  } catch {
    return false;
  }
}

function seed(): void {
  console.log("Seeding the local project, because the seeded key was refused...");
  execFileSync("pnpm", ["run", "prisma:seed"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    timeout: 300_000,
  });
}

export default async function setup(): Promise<() => Promise<void>> {
  loadWorkspaceEnv();
  const project = seededProject();

  const stack: RunningStack = await startStack({
    port: STACK_PORT,
    baseUrlHint: localHint(),
  });
  console.log(`Stack (${stack.source}): ${stack.baseUrl}`);

  if (!(await keyIsAccepted(stack.baseUrl, project.apiKey))) {
    seed();
    if (!(await keyIsAccepted(stack.baseUrl, project.apiKey))) {
      await stack.stop();
      throw new Error(
        `the seeded project key is refused at ${stack.baseUrl} even after seeding; ` +
          `the stack and the seed must share one CREDENTIALS_SECRET`,
      );
    }
  }

  writeStackHandoff({
    baseUrl: stack.baseUrl,
    apiKey: project.apiKey,
    organizationApiKey: project.organizationApiKey,
    projectId: project.projectId,
  });

  process.env.LANGWATCH_ENDPOINT = stack.baseUrl;
  process.env.LANGWATCH_API_KEY = project.apiKey;

  console.log(`Seeded project ${project.projectSlug} is reachable; starting tests.`);

  return async () => {
    await stack.stop();
  };
}
