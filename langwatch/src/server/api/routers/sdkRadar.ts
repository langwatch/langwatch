import semver from "semver";
import { z } from "zod";
import { prisma } from "~/server/db";
import { getLatestSdkVersions } from "~/server/sdk-radar/latestSdkVersions";
import { SDK_REGISTRY } from "~/server/sdk-radar/sdkVersions.config";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

interface VersionStats {
  version: string;
  count: number;
  lastEventTimestamp: number | null;
  isOutdated: boolean;
}

interface SdkStats {
  sdkName: string;
  sdkLanguage: string;
  displayName: string;
  latestVersion: string;
  releasesUrl: string;
  docsUrl: string;
  installCommands: Record<string, string>;
  versions: VersionStats[];
  totalCount: number;
}

export const sdkRadarRouter = createTRPCRouter({
  getVersionStats: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0]!;

      const [rows, dynamicVersions] = await Promise.all([
        prisma.projectDailySdkUsage.findMany({
          where: {
            projectId: input.projectId,
            date: { gte: sevenDaysAgoStr },
            sdkName: { not: "" },
          },
        }),
        getLatestSdkVersions(),
      ]);

      // Group by sdkName + sdkLanguage
      const grouped = new Map<
        string,
        Map<string, { count: number; lastEventTimestamp: bigint | null }>
      >();

      for (const row of rows) {
        const groupKey = `${row.sdkName}:${row.sdkLanguage}`;

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, new Map());
        }

        const versions = grouped.get(groupKey)!;
        const existing = versions.get(row.sdkVersion);

        if (existing) {
          existing.count += row.count;
          if (
            row.lastEventTimestamp != null &&
            (existing.lastEventTimestamp == null ||
              row.lastEventTimestamp > existing.lastEventTimestamp)
          ) {
            existing.lastEventTimestamp = row.lastEventTimestamp;
          }
        } else {
          versions.set(row.sdkVersion, {
            count: row.count,
            lastEventTimestamp: row.lastEventTimestamp,
          });
        }
      }

      const sdks: SdkStats[] = [];
      let hasOutdated = false;

      for (const [groupKey, versions] of grouped) {
        const [sdkName, sdkLanguage] = groupKey.split(":");
        if (!sdkName || !sdkLanguage) continue;

        // Skip "other" bucket (non-LangWatch SDKs)
        if (sdkName === "other") continue;

        const registryEntry = SDK_REGISTRY[sdkName]?.[sdkLanguage];
        if (!registryEntry) continue;

        // Use dynamic version from GitHub if available, else fallback to config
        const latestVersion =
          dynamicVersions[registryEntry.releaseTagPrefix] ??
          registryEntry.latestVersion;

        const versionStats: VersionStats[] = [];
        let totalCount = 0;

        for (const [version, data] of versions) {
          const isOutdated = semver.valid(version) && semver.valid(latestVersion)
            ? semver.lt(version, latestVersion)
            : true;

          if (isOutdated) {
            hasOutdated = true;
          }

          totalCount += data.count;
          versionStats.push({
            version,
            count: data.count,
            lastEventTimestamp:
              data.lastEventTimestamp != null
                ? Number(data.lastEventTimestamp)
                : null,
            isOutdated,
          });
        }

        // Sort versions descending (newest first)
        versionStats.sort((a, b) => {
          const aValid = semver.valid(a.version);
          const bValid = semver.valid(b.version);
          if (aValid && bValid) return semver.rcompare(a.version, b.version);
          if (aValid) return -1;
          if (bValid) return 1;
          return a.version.localeCompare(b.version);
        });

        sdks.push({
          sdkName,
          sdkLanguage,
          displayName: registryEntry.displayName,
          latestVersion,
          releasesUrl: registryEntry.releasesUrl,
          docsUrl: registryEntry.docsUrl,
          installCommands: registryEntry.installCommands,
          versions: versionStats,
          totalCount,
        });
      }

      return { sdks, hasOutdated };
    }),
});
