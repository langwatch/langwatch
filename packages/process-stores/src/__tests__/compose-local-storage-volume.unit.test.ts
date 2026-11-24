/**
 * With no object storage, the app and the workers must mount one named volume at the local
 * storage root, or each writes its own folder and a recreate loses the dataset files.
 * Spec: specs/datasets/storage-object-only/self-hosting-and-docs.feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_LOCAL_STORAGE_ROOT } from "../local-storage-root.ts";

function readFromRoot(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

/** A top-level block of a compose file (`services:`, `volumes:`): its lines up to the next one. */
function topLevelBlock({ text, name }: { text: string; name: string }): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(`${name}:`);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The service block of a compose file: its lines up to the next top-level service. */
function composeService({ text, name }: { text: string; name: string }): string[] {
  const lines = topLevelBlock({ text, name: "services" });
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The named volumes a service mounts, by container path. */
function namedMounts(service: string[]): Map<string, string> {
  const mounts = new Map<string, string>();
  for (const line of service) {
    const mount = /^\s+- ([A-Za-z0-9][\w.-]*):(\/[^:\s]*)/.exec(line);
    if (mount) mounts.set(mount[2]!, mount[1]!);
  }
  return mounts;
}

/** The last stage of a Dockerfile: what the published image is. */
function runtimeStage(dockerfile: string): string {
  const stages = dockerfile.split(/^FROM /m);
  return stages.at(-1) ?? "";
}

describe("given the docker compose install with no object storage configured", () => {
  const compose = readFromRoot("infra/compose.yml");

  /** @scenario "Docker compose keeps dataset files on one volume shared by the app and the workers" */
  it("mounts one named volume at the local storage root in both the app and the workers", () => {
    const app = namedMounts(composeService({ text: compose, name: "app" }));
    const workers = namedMounts(composeService({ text: compose, name: "workers" }));
    const appVolume = app.get(DEFAULT_LOCAL_STORAGE_ROOT);
    const workersVolume = workers.get(DEFAULT_LOCAL_STORAGE_ROOT);

    expect(appVolume, "the app mounts no volume at the local storage root").toBeDefined();
    expect(workersVolume, "the workers read the same volume the app writes").toBe(appVolume);

    // A volume declared at the top level outlives the containers: `docker compose up` after a
    // recreate mounts the same one again.
    const declared = topLevelBlock({ text: compose, name: "volumes" }).map((line) => line.trim());
    expect(declared).toContain(`${appVolume}:`);
  });

  /** @scenario "Docker compose keeps dataset files on one volume shared by the app and the workers" */
  it("ships an image that creates the local storage root for the user the chart runs as", () => {
    // A named volume copies the folder's owner from the image the first time it mounts, and the
    // chart runs the image as uid 1000 (`node`), so a folder that only appears at mount time
    // would be root-owned there and unwritable.
    const stage = runtimeStage(readFromRoot("infra/docker/Dockerfile"));
    const root = DEFAULT_LOCAL_STORAGE_ROOT.replaceAll("/", "\\/");
    expect(stage).toMatch(new RegExp(`mkdir -p ${root}\\b`));
    expect(stage).toMatch(new RegExp(`chown (node:node|1000:1000) ${root}\\b`));
  });
});
