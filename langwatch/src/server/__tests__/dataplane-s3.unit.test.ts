/**
 * @vitest-environment node
 *
 * Unit tests for DATAPLANE_S3 env var parsing and routing.
 *
 * Env var format: DATAPLANE_S3__<label>__org__<orgId>=<jsonConfig>
 * JSON: { endpoint, bucket, accessKeyId, secretAccessKey }
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => mockLogger,
}));

vi.mock("../db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

describe("dataplane-s3", () => {
  const VALID_CONFIG = JSON.stringify({
    endpoint: "https://s3.eu-central-1.amazonaws.com",
    bucket: "langwatch-storage-acme",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret123",
  });

  const VALID_CONFIG_2 = JSON.stringify({
    endpoint: "https://s3.us-west-2.amazonaws.com",
    bucket: "langwatch-storage-beta",
    accessKeyId: "AKIABETA",
    secretAccessKey: "betasecret",
  });

  afterEach(() => {
    vi.resetModules();
    // Clean up any DATAPLANE_S3 env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("DATAPLANE_S3__")) {
        delete process.env[key];
      }
    }
    vi.clearAllMocks();
  });

  describe("parsePrivateS3EnvVars", () => {
    describe("when valid JSON env vars are set", () => {
      it("parses a single org config", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org123");
        expect(config).toEqual({
          endpoint: "https://s3.eu-central-1.amazonaws.com",
          bucket: "langwatch-storage-acme",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret123",
        });
      });

      it("parses multiple org configs", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;
        process.env["DATAPLANE_S3__beta__org__org456"] = VALID_CONFIG_2;

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config1 = getS3ConfigForOrganization("org123");
        expect(config1).toEqual({
          endpoint: "https://s3.eu-central-1.amazonaws.com",
          bucket: "langwatch-storage-acme",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret123",
        });

        const config2 = getS3ConfigForOrganization("org456");
        expect(config2).toEqual({
          endpoint: "https://s3.us-west-2.amazonaws.com",
          bucket: "langwatch-storage-beta",
          accessKeyId: "AKIABETA",
          secretAccessKey: "betasecret",
        });
      });

      it("ignores the label portion of the env var name", async () => {
        process.env["DATAPLANE_S3__any-label-here__org__org123"] = VALID_CONFIG;

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org123");
        expect(config).not.toBeNull();
        expect(config!.bucket).toBe("langwatch-storage-acme");
      });

      it("logs info about loaded configs", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;

        await import("../dataplane-s3");

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ orgId: "org123" }),
          expect.stringContaining("Loaded private S3 config"),
        );
      });
    });

    describe("when invalid JSON env var is set", () => {
      it("skips the invalid entry and logs a warning", async () => {
        process.env["DATAPLANE_S3__bad__org__org999"] = "not-json";

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org999");
        expect(config).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ orgId: "org999" }),
          expect.stringContaining("invalid JSON"),
        );
      });
    });

    describe("when env var has missing required fields", () => {
      it("skips the entry and logs a warning", async () => {
        process.env["DATAPLANE_S3__partial__org__org888"] = JSON.stringify({
          endpoint: "https://s3.amazonaws.com",
          // missing bucket, accessKeyId, secretAccessKey
        });

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org888");
        expect(config).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalled();
      });
    });

    describe("when no DATAPLANE_S3 env vars are set", () => {
      it("returns null for any org", async () => {
        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org-unknown");
        expect(config).toBeNull();
      });
    });
  });

  describe("getS3ConfigForOrganization", () => {
    describe("when org has a private S3 configured", () => {
      it("returns the private config", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;

        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org123");
        expect(config).not.toBeNull();
        expect(config!.endpoint).toBe(
          "https://s3.eu-central-1.amazonaws.com",
        );
      });
    });

    describe("when org has no private S3 configured", () => {
      it("returns null", async () => {
        const { getS3ConfigForOrganization } = await import(
          "../dataplane-s3"
        );

        const config = getS3ConfigForOrganization("org-nonexistent");
        expect(config).toBeNull();
      });
    });
  });

  describe("getS3ConfigForProject", () => {
    describe("when project belongs to org with private S3", () => {
      it("returns the private S3 config", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;

        const { prisma } = await import("../db");
        vi.mocked(prisma.project.findUnique).mockResolvedValue({
          team: { organizationId: "org123" },
        } as any);

        const { getS3ConfigForProject } = await import("../dataplane-s3");

        const config = await getS3ConfigForProject("proj-abc");
        expect(config).not.toBeNull();
        expect(config!.bucket).toBe("langwatch-storage-acme");
      });
    });

    describe("when project belongs to org without private S3", () => {
      it("returns null", async () => {
        const { prisma } = await import("../db");
        vi.mocked(prisma.project.findUnique).mockResolvedValue({
          team: { organizationId: "org-no-private" },
        } as any);

        const { getS3ConfigForProject } = await import("../dataplane-s3");

        const config = await getS3ConfigForProject("proj-xyz");
        expect(config).toBeNull();
      });
    });

    describe("when project is not found", () => {
      it("returns null", async () => {
        const { prisma } = await import("../db");
        vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

        const { getS3ConfigForProject } = await import("../dataplane-s3");

        const config = await getS3ConfigForProject("proj-missing");
        expect(config).toBeNull();
      });
    });

    describe("when called twice for the same project", () => {
      it("caches the org lookup and does not query DB again", async () => {
        process.env["DATAPLANE_S3__acme__org__org123"] = VALID_CONFIG;

        const { prisma } = await import("../db");
        vi.mocked(prisma.project.findUnique).mockResolvedValue({
          team: { organizationId: "org123" },
        } as any);

        const { getS3ConfigForProject } = await import("../dataplane-s3");

        await getS3ConfigForProject("proj-cached");
        await getS3ConfigForProject("proj-cached");

        expect(prisma.project.findUnique).toHaveBeenCalledTimes(1);
      });
    });
  });
});
