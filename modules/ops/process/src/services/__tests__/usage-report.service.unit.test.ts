/**
 * Where the daily report goes, what switching things off stops, and how the
 * answer is written down. Specs under specs/self-hosting/: connected-services
 * usage-report and license-sync, and checkup/checkup.feature.
 */
import type {
  ConnectDeploymentView,
  InstanceIdentityView,
} from "@langwatch/enterprise-licensing-contract";
import { INSTANCE_ID_NOT_MINTED, USAGE_REPORT_SCHEMA_VERSION } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryUsageReportChannel } from "../../channels/memory/memory.usage-report.channel.ts";
import { MemoryCloudLatestReleaseRepository } from "../../repositories/memory/memory.cloud-latest-release.repository.ts";
import { MemoryCloudNoticeRepository } from "../../repositories/memory/memory.cloud-notice.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { UsageReportCollectionService } from "../usage-report-collection.service.ts";
import {
  USAGE_REPORT_APP_HOST_URL,
  type UsageReportInstall,
  UsageReportService,
} from "../usage-report.service.ts";
import { UsageReportWorld } from "./support/usage-report-peers.ts";

/** The install's identity and Connect state, held in memory the way licensing holds them. */
class InstallStandIn implements UsageReportInstall {
  identity: InstanceIdentityView | undefined;
  connect: ConnectDeploymentView = {
    permitted: true,
    connected: false,
    licenseEndpoint: "https://connect.langwatch.ai",
    gatewayEndpoint: "https://gateway.langwatch.ai",
    licenseKeySource: "override",
    licenseKeyFingerprint: "0123456789abcdef",
    licenseId: "lic-dev",
    licenseVerified: true,
  };
  readonly outcomes: (string | undefined)[] = [];
  minted = 0;

  async findInstanceIdentity(): Promise<InstanceIdentityView[]> {
    return this.identity ? [this.identity] : [];
  }

  async getInstanceId(): Promise<string> {
    if (!this.identity) {
      this.minted++;
      this.identity = {
        instanceId: "4b1c",
        createdAt: "2026-08-01T00:00:00.000Z",
        optionalMetricsOptOut: false,
        hostnameOptOut: false,
        upgradeDiagnosticsOptOut: false,
      };
    }
    return this.identity.instanceId;
  }

  async getConnectDeployment(): Promise<ConnectDeploymentView> {
    return this.connect;
  }

  async recordUsageReportOutcome({ error }: { error?: string }): Promise<void> {
    this.outcomes.push(error);
  }

  async setUsageReportSwitches(input: {
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<void> {
    await this.getInstanceId();
    if (this.identity) this.identity = { ...this.identity, ...input };
  }
}

const NOW = Temporal.Instant.from("2026-09-21T10:00:00.000Z");

let state: UsageReportWorld;
let channel: MemoryUsageReportChannel;
let install: InstallStandIn;
let opsHealthReads: number;
let latestReleases: MemoryCloudLatestReleaseRepository;
let notices: MemoryCloudNoticeRepository;

const OPS_HEALTH = {
  snapshot_at: "2026-09-21T09:59:00.000Z",
  failed_jobs_total: 0,
  queues: {},
  pipelines: {},
  migrations: { tenant_split_v2: { parked: 1, rolled_back: 0 } },
};

function service({ disabled = false, isSaas = false } = {}) {
  return UsageReportService.create({
    collection: UsageReportCollectionService.create({
      peers: state.peers(),
      opsHealth: {
        read: async () => {
          opsHealthReads++;
          return OPS_HEALTH;
        },
      },
      deployment: () => ({
        version: "3.17.0",
        installMethod: "self-hosted",
        chartVersion: undefined,
        environment: "production",
        hostname: "langwatch.acme.test",
        authMethod: "email",
      }),
    }),
    organizations: {
      listAllIds: async () => ({ ids: [...state.projectsByOrganization.keys()], next: null }),
    },
    channel,
    install,
    latestReleases,
    notices,
    disabled,
    isSaas,
    now: () => NOW,
  });
}

beforeEach(() => {
  state = UsageReportWorld.create();
  state.projectsByOrganization.set("org_1", ["project_1"]);
  state.projectsByOrganization.set("org_2", ["project_2"]);
  channel = MemoryUsageReportChannel.create();
  latestReleases = MemoryCloudLatestReleaseRepository.create({ store: MemoryOpsStore.create() });
  notices = MemoryCloudNoticeRepository.create({ store: MemoryOpsStore.create() });
  install = new InstallStandIn();
  opsHealthReads = 0;
});

describe("given an install whose license names a hosted service", () => {
  beforeEach(() => {
    install.connect = { ...install.connect, connected: true };
  });

  describe("when the daily report runs", () => {
    /** @scenario "Product statistics go to the connect host, not the app host" */
    it("posts the statistics to the connect host", async () => {
      await service().send();

      expect(channel.posts.map((post) => post.endpoint)).toEqual([
        "https://connect.langwatch.ai/v1/stats",
      ]);
    });
  });

  describe("when usage statistics are switched off for the deployment", () => {
    /** @scenario "Product statistics stay optional and separate" */
    /** @scenario "An operator's opt-out stops the usage report" */
    it("sends no statistics", async () => {
      expect(await service({ disabled: true }).send()).toBe("switched_off");
      expect(channel.posts).toEqual([]);
    });

    /** @scenario "DISABLE_USAGE_STATS sends no ops health either" */
    it("does not even read ops health", async () => {
      await service({ disabled: true }).send();

      expect(opsHealthReads).toBe(0);
      expect(channel.posts).toEqual([]);
    });
  });
});

describe("given the deployment is the hosted product", () => {
  describe("when the daily report runs", () => {
    /** @scenario "The hosted product sends no self-hosted usage report" */
    it("takes no report and posts nothing", async () => {
      expect(await service({ isSaas: true }).send()).toBe("switched_off");
      expect(channel.posts).toEqual([]);
      expect(install.minted).toBe(0);
    });
  });
});

describe("given an install with Connect switched off for an audit", () => {
  describe("when the daily report runs", () => {
    /** @scenario "An install told to reach LangWatch for nothing sends no report either" */
    it("takes no report and posts nothing", async () => {
      install.connect = { ...install.connect, permitted: false, connected: true };

      expect(await service().send()).toBe("connect_disabled");
      expect(channel.posts).toEqual([]);
      expect(install.minted).toBe(0);
    });
  });
});

describe("given an install on an offline license", () => {
  describe("when the daily report runs", () => {
    /** @scenario "An install on an offline license keeps its telemetry destination" */
    it("posts the statistics where it always did", async () => {
      await service().send();

      expect(channel.posts[0]?.endpoint).toBe(USAGE_REPORT_APP_HOST_URL);
    });
  });
});

describe("given cloud's reply names a latest release", () => {
  describe("when the daily report is sent", () => {
    /** @scenario "The usage report keeps the latest release cloud's reply names" */
    it("keeps it for the status, and forgets it when a later reply names none", async () => {
      channel.latestRelease = { release: "3.22.0", commit: "def5678" };
      expect(await service().send()).toBe("sent");
      expect(await service().findLatestRelease()).toEqual([
        { release: "3.22.0", commit: "def5678" },
      ]);

      channel.latestRelease = null;
      await service().send();
      expect(await service().findLatestRelease()).toEqual([]);
    });
  });

  describe("when usage reporting is switched off", () => {
    /** @scenario "No latest release is named when usage reporting is off" */
    it("names none", async () => {
      await latestReleases.save({ release: "3.22.0", commit: null });
      expect(await service({ disabled: true }).findLatestRelease()).toEqual([]);
    });
  });
});

describe("given cloud's reply names notices", () => {
  const notice = (id: string) => ({
    id,
    severity: "info" as const,
    title: `Notice ${id}`,
    body: "",
    url: null,
    fixed_in: null,
    published_at: "2026-10-20T09:00:00.000Z",
  });

  describe("when the daily report is sent", () => {
    /** @scenario "The usage report keeps the notices cloud's reply names" */
    it("keeps both for the status, and forgets them when a later reply names none", async () => {
      channel.notices = [notice("n1"), notice("n2")];
      expect(await service().send()).toBe("sent");
      expect(await service().findNotices()).toEqual([notice("n1"), notice("n2")]);

      channel.notices = [];
      await service().send();
      expect(await service().findNotices()).toEqual([]);
    });
  });

  describe("when usage reporting is switched off", () => {
    /** @scenario "No notices are named when usage reporting is off" */
    it("names none", async () => {
      await notices.save([notice("n1")]);
      expect(await service({ disabled: true }).findNotices()).toEqual([]);
    });
  });

  describe("when LangWatch Connect is disabled", () => {
    it("forgets the notices it held", async () => {
      await notices.save([notice("n1")]);
      install.connect = { ...install.connect, permitted: false };
      expect(await service().send()).toBe("connect_disabled");
      expect(await notices.find()).toEqual([]);
    });
  });
});

describe("given an install that reports", () => {
  describe("when the report is posted", () => {
    /** @scenario "The daily usage report is one report for the whole install" */
    it("sends one report for the whole install under the minted identity", async () => {
      expect(await service().send()).toBe("sent");

      expect(channel.posts).toHaveLength(1);
      expect(channel.posts[0]?.body).toMatchObject({
        event: "daily_usage_stats",
        instance_id: "4b1c",
        organizations: 2,
        first_seen_at: "2026-08-01T00:00:00.000Z",
      });
      expect(install.outcomes).toEqual([undefined]);
    });
  });

  describe("when the install verifies licenses against an override key", () => {
    /** @scenario "The report says whether licenses verify against the embedded key or an override" */
    it("says the key is an override", async () => {
      await service().send();

      expect(channel.posts[0]?.body).toMatchObject({ license_key_source: "override" });
    });

    /** @scenario "The report fingerprints the verifying key and never carries it" */
    it("carries the key's fingerprint", async () => {
      await service().send();

      expect(channel.posts[0]?.body).toMatchObject({
        license_key_fingerprint: "0123456789abcdef",
      });
    });

    /** @scenario "The report names the active license and whether it verified" */
    it("names the active license", async () => {
      await service().send();

      expect(channel.posts[0]?.body).toMatchObject({ license_id: "lic-dev" });
    });

    /** @scenario "The report names the active license and whether it verified" */
    it("says whether the license verified", async () => {
      install.connect = { ...install.connect, licenseVerified: false };

      await service().send();

      expect(channel.posts[0]?.body).toMatchObject({ license_verified: false });
    });
  });

  describe("when the host refuses the report", () => {
    it("writes the refusal down by status, so the checkup can show it", async () => {
      channel.status = 413;

      expect(await service().send()).toBe("refused");
      expect(install.outcomes).toEqual(["usage_report_refused_413"]);
    });
  });

  describe("when no host answers", () => {
    it("writes the report down as unreachable", async () => {
      channel.unreachable = true;

      expect(await service().send()).toBe("unreachable");
      expect(install.outcomes).toEqual(["usage_report_unreachable"]);
    });
  });
});

describe("the usage report preview", () => {
  describe("given an install that has reported before", () => {
    /** @scenario "The page shows the exact report the install would send" */
    it("returns the payload the sender would post, and the host it goes to", async () => {
      await install.getInstanceId();

      const preview = await service().preview();

      expect(preview.payload).toMatchObject({ event: "daily_usage_stats", instance_id: "4b1c" });
      expect(preview.endpoint).toBe(USAGE_REPORT_APP_HOST_URL);
      expect(preview.schemaVersion).toBe(USAGE_REPORT_SCHEMA_VERSION);
      expect(preview.nextReportAt).toBe("2026-09-21T12:00:00.000Z");
      expect(channel.posts).toEqual([]);
    });
  });

  describe("given a process that composes ops health", () => {
    /** @scenario "The preview shows ops health like every other field" */
    it("shows ops_health in the payload it would post", async () => {
      await install.getInstanceId();

      const preview = await service().preview();

      expect(preview.payload.ops_health).toEqual(OPS_HEALTH);
    });
  });

  describe("when an administrator switched the optional category off", () => {
    /** @scenario "The two switches change the preview" */
    it("carries no optional field", async () => {
      state.emailDomains = { "acme.test": 1 };

      const preview = await service().setSwitches({ optionalMetricsOptOut: true });

      expect(preview.switches).toEqual({
        optional: false,
        hostname: true,
      });
      expect(preview.payload.user_email_domains).toBeUndefined();
      expect(preview.payload.totalTraces).toBeUndefined();
      expect(preview.payload.ops_health).toBeUndefined();
    });
  });

  describe("when the identity row has opted out of upgrade diagnostics", () => {
    it("leaves that switch out of the report's switches, which name only what the report sends", async () => {
      await install.getInstanceId();
      if (install.identity)
        install.identity = { ...install.identity, upgradeDiagnosticsOptOut: true };

      const preview = await service().preview();

      expect(preview.switches).toEqual({ optional: true, hostname: true });
    });
  });

  describe("when the install has never minted an identity", () => {
    it("shows a placeholder rather than minting one", async () => {
      const preview = await service({ disabled: true }).preview();

      expect(preview.payload.instance_id).toBe(INSTANCE_ID_NOT_MINTED);
      expect(preview.disabled).toBe(true);
      expect(preview.nextReportAt).toBeNull();
      expect(install.minted).toBe(0);
    });
  });
});
