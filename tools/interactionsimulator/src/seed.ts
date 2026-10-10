import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

/** The simulator's own identity on the shared stack: its org never collides with another tool's. */
export const SIMULATOR = {
  email: "simulator@mail.langwatch.localhost",
  password: "SimulatorLocal!2026",
  name: "Interaction Simulator",
  organization: "simulator",
  project: "simulator",
} as const;

const permissionDenied = z.object({ code: z.literal("EPERM") });
const alreadyExists = z.object({ code: z.literal("EEXIST") });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (thrown) {
    return permissionDenied.validate(thrown);
  }
};

/**
 * withLock runs work while holding `file`, waiting for another holder and
 * taking over from a dead one.
 * ponytail: an O_EXCL pid file, as Node has no flock; move to diffkit's lock once it has a CLI.
 */
export const withLock = async <Value>({
  file,
  work,
}: {
  file: string;
  work: () => Promise<Value>;
}): Promise<Value> => {
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(file, "wx");
      writeFileSync(descriptor, String(process.pid));
    } catch (thrown) {
      if (!alreadyExists.validate(thrown)) throw thrown;
      const holder = Number(readFileSync(file, "utf8"));
      const isStale = Number.isInteger(holder) && holder > 0;
      if (isStale && !isAlive(holder)) rmSync(file, { force: true });
      else await sleep(500);
    }
  }
  try {
    return await work();
  } finally {
    closeSync(descriptor);
    rmSync(file, { force: true });
  }
};

const organizationsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    teams: z.array(
      z.looseObject({ id: z.string(), projects: z.array(z.looseObject({ slug: z.string() })) }),
    ),
  }),
);

const createdSchema = z.looseObject({
  organization: z.looseObject({ id: z.string() }),
  team: z.looseObject({ id: z.string() }),
});

const provisionedSchema = z.looseObject({ projectSlug: z.string() });

const trpcSchema = z.object({ result: z.object({ data: z.unknown() }) });

/**
 * seedSimulator makes sure the `simulator` organization and its project exist
 * on the stack, through the public API, under a lock so two runs never seed
 * at once. Every call is idempotent: an existing user, org or project is kept.
 */
export const seedSimulator = async ({
  url,
  dir,
}: {
  url: string;
  dir: string;
}): Promise<{ slug: string }> => {
  mkdirSync(dir, { recursive: true });
  return withLock({
    file: join(dir, "seed.lock"),
    work: async () => {
      const origin = new URL(url).origin;
      const headers = { "content-type": "application/json", origin };
      const post = (path: string, body: unknown, cookie = ""): Promise<Response> =>
        fetch(`${origin}${path}`, {
          method: "POST",
          headers: cookie === "" ? headers : { ...headers, cookie },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      const { email, password, name } = SIMULATOR;
      await post("/api/auth/sign-up/email", { name, email, password });
      const signedIn = await post("/api/auth/sign-in/email", { email, password });
      if (!signedIn.ok)
        throw new Error(
          `the simulator could not sign in: ${signedIn.status} ${await signedIn.text()}`,
        );
      const cookie = signedIn.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .join("; ");
      const trpc = async (
        procedure: string,
        input: unknown,
        method: "GET" | "POST",
      ): Promise<unknown> => {
        const response =
          method === "GET"
            ? await fetch(
                `${origin}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
                {
                  headers: { ...headers, cookie },
                  signal: AbortSignal.timeout(30_000),
                },
              )
            : await post(`/api/trpc/${procedure}`, input, cookie);
        if (!response.ok)
          throw new Error(
            `${procedure} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
          );
        return trpcSchema.parse(await response.json()).result.data;
      };
      const organizations = organizationsSchema.parse(await trpc("organization.getAll", {}, "GET"));
      const existing = organizations.find(
        (organization) => organization.name === SIMULATOR.organization,
      );
      const slug = existing?.teams.flatMap((team) => team.projects)[0]?.slug;
      if (slug !== undefined) return { slug };
      const created = existing
        ? { organizationId: existing.id, teamId: existing.teams[0]?.id }
        : await trpc(
            "organization.createAndAssign",
            { orgName: SIMULATOR.organization },
            "POST",
          ).then((data) => {
            const parsed = createdSchema.parse(data);
            return { organizationId: parsed.organization.id, teamId: parsed.team.id };
          });
      const provisioned = provisionedSchema.parse(
        await trpc(
          "project.create",
          { ...created, name: SIMULATOR.project, language: "other", framework: "other" },
          "POST",
        ),
      );
      writeFileSync(
        join(dir, "seed.json"),
        `${JSON.stringify({ url, slug: provisioned.projectSlug }, null, 2)}\n`,
      );
      return { slug: provisioned.projectSlug };
    },
  });
};
