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
        startupNoticeAcknowledgedSchemaVersion: 0,
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

  async acknowledgeStartupNotice({ schemaVersion }: { schemaVersion: number }): Promise<void> {
    await this.getInstanceId();
    if (this.identity) {
      this.identity = { ...this.identity, startupNoticeAcknowledgedSchemaVersion: schemaVersion };
    }
  }
}

const NOW = Temporal.Instant.from("2026-09-21T10:00:00.000Z");

let state: UsageReportWorld;
let channel: MemoryUsageReportChannel;
let install: InstallStandIn;

function service({ disabled = false, isSaas = false } = {}) {
  return UsageReportService.create({
    collection: UsageReportCollectionService.create({
      peers: state.peers(),
      deployment: () => ({
        version: "3.17.0",
        installMethod: "self-hosted",
        chartVersion: undefined,
        environment: "production",
        hostname: "langwatch.acme.test",
        authMethod: "email",
      }),
    }),
    organizations: { findAllIds: async () => [...state.projectsByOrganization.keys()] },
    channel,
    install,
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
  install = new InstallStandIn();
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
    it("sends no statistics", async () => {
      expect(await service({ disabled: true }).send()).toBe("switched_off");
      expect(channel.posts).toEqual([]);
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

  describe("when an administrator switched the optional category off", () => {
    /** @scenario "The two switches change the preview" */
    it("carries no optional field", async () => {
      state.emailDomains = { "acme.test": 1 };

      const preview = await service().setSwitches({ optionalMetricsOptOut: true });

      expect(preview.switches).toEqual({ optional: false, hostname: true });
      expect(preview.payload.user_email_domains).toBeUndefined();
      expect(preview.payload.totalTraces).toBeUndefined();
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

describe("the startup notice", () => {
  describe("given a fresh self-hosted install", () => {
    it("is due without minting an identity, and stays dismissed once dismissed", async () => {
      const reports = service();

      expect((await reports.getStartupNotice()).show).toBe(true);
      expect(install.minted).toBe(0);

      expect(
        await reports.dismissStartupNotice({ schemaVersion: USAGE_REPORT_SCHEMA_VERSION }),
      ).toBe(true);
      expect((await reports.getStartupNotice()).show).toBe(false);
    });
  });

  describe("given LangWatch Cloud", () => {
    it("is never due and records no dismissal", async () => {
      const reports = service({ isSaas: true });

      expect((await reports.getStartupNotice()).show).toBe(false);
      expect(await reports.dismissStartupNotice({ schemaVersion: 3 })).toBe(false);
      expect(install.minted).toBe(0);
    });
  });
});
