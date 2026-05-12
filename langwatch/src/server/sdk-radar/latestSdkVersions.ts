import semver from "semver";
import { connection } from "~/server/redis";
import { SDK_REGISTRY } from "./sdkVersions.config";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:sdk-radar");

const REDIS_KEY = "sdk-radar:latest-sdk-versions";
const TTL_SECONDS = 3_600; // 1 hour

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/langwatch/langwatch/releases?per_page=100";

interface GitHubRelease {
  tag_name: string | undefined;
}

/**
 * Collect all unique release tag prefixes from the SDK registry.
 * Maps prefix → extracted version separator (either "@v" or "/v").
 */
function getTagPrefixes(): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const languages of Object.values(SDK_REGISTRY)) {
    for (const info of Object.values(languages)) {
      if (!prefixes.has(info.releaseTagPrefix)) {
        prefixes.set(info.releaseTagPrefix, info.releaseTagPrefix);
      }
    }
  }
  return prefixes;
}

/**
 * Given a tag and a prefix, extract the semver version string.
 * e.g. "typescript-sdk@v0.16.1" with prefix "typescript-sdk@v" → "0.16.1"
 *      "sdk-go/v0.2.0" with prefix "sdk-go/v" → "0.2.0"
 */
function extractVersion({
  tag,
  prefix,
}: {
  tag: string;
  prefix: string;
}): string | null {
  if (!tag.startsWith(prefix)) return null;
  const version = tag.slice(prefix.length);
  return semver.valid(version) ? version : null;
}

async function fetchFromGitHub(): Promise<Record<string, string>> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const releases = (await response.json()) as GitHubRelease[];
  const prefixes = getTagPrefixes();
  const latest: Record<string, string> = {};

  if (Array.isArray(releases)) {
    for (const [prefix] of prefixes) {
      let best: string | null = null;

      for (const release of releases) {
        if (!release.tag_name) continue;

        const version = extractVersion({ tag: release.tag_name, prefix });
        if (!version) continue;
        if (!best || semver.gt(version, best)) {
          best = version;
        }
      }

      if (best) {
        // Store keyed by prefix so consumers can look up by prefix
        latest[prefix] = best;
      }
    }
  }

  return latest;
}

/**
 * Get latest SDK versions, trying Redis cache first, then GitHub, then fallback.
 * Returns a map of releaseTagPrefix → latest version string.
 */
export async function getLatestSdkVersions(): Promise<Record<string, string>> {
  // Try Redis cache
  try {
    if (connection) {
      const cached = await connection.get(REDIS_KEY);
      if (cached) {
        return JSON.parse(cached) as Record<string, string>;
      }
    }
  } catch (error) {
    logger.warn({ error }, "Failed to read SDK versions from Redis cache");
  }

  // Try GitHub
  try {
    const versions = await fetchFromGitHub();

    // Cache in Redis
    try {
      if (connection) {
        await connection.setex(
          REDIS_KEY,
          TTL_SECONDS,
          JSON.stringify(versions),
        );
      }
    } catch (error) {
      logger.warn({ error }, "Failed to cache SDK versions in Redis");
    }

    return versions;
  } catch (error) {
    logger.warn({ error }, "Failed to fetch SDK versions from GitHub");
  }

  // Fallback to hardcoded config versions
  const fallback: Record<string, string> = {};
  for (const languages of Object.values(SDK_REGISTRY)) {
    for (const info of Object.values(languages)) {
      fallback[info.releaseTagPrefix] = info.latestVersion;
    }
  }

  return fallback;
}
