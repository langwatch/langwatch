/**
 * What a license says this install may call.
 *
 * The point of these is the absence: an install holding a license that names
 * no hosted service resolves an empty entitlement, which is what every
 * outbound path checks before it builds a client. There is no variable that
 * turns that into a yes.
 *
 * @see ../connectEntitlement.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  connectServiceEnabled,
  installIsEntitled,
  licenseConnectServices,
  organizationEnabledConnectServices,
} from "../connectEntitlement";
import {
  LANGWATCH_KEYS,
  mintLicense,
  NOW,
  ORGANIZATION_ID,
  STRANGER_KEYS,
} from "./installFakes";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));

const PUBLIC_KEY = LANGWATCH_KEYS.publicKey;

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

interface Row {
  license: string | null;
  connectServicesDisabled: string[];
}

function prismaWith(rows: Row[]): PrismaClient {
  return {
    organization: {
      findUnique: async () => rows[0] ?? null,
      findMany: async () => rows.filter((row) => row.license !== null),
    },
  } as unknown as PrismaClient;
}

describe("given a license that names two hosted services", () => {
  describe("when the install reads its entitlement", () => {
    it("names both", () => {
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals", "managed_models"],
      });

      expect(
        licenseConnectServices({ licenseKey, publicKey: PUBLIC_KEY, now: NOW }),
      ).toEqual(["instant_evals", "managed_models"]);
    });
  });
});

describe("given a license that names no hosted service", () => {
  describe("when the install reads its entitlement", () => {
    /** @scenario "A license that names no hosted service reaches nothing" */
    it("names none, so no outbound path builds a client", () => {
      const { licenseKey } = mintLicense({ connectServices: [] });

      expect(
        licenseConnectServices({ licenseKey, publicKey: PUBLIC_KEY, now: NOW }),
      ).toEqual([]);
    });
  });
});

describe("given a license that names a service this release has no code for", () => {
  describe("when the install reads its entitlement", () => {
    it("drops the unknown name rather than carrying it", () => {
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals", "time_travel"],
      });

      expect(
        licenseConnectServices({ licenseKey, publicKey: PUBLIC_KEY, now: NOW }),
      ).toEqual(["instant_evals"]);
    });
  });
});

describe("given a license signed by a key that is not ours", () => {
  describe("when the install reads its entitlement", () => {
    it("names none, so an edited blob cannot grant itself a service", () => {
      const { licenseKey } = mintLicense({
        privateKey: STRANGER_KEYS.privateKey,
        connectServices: ["instant_evals"],
      });

      expect(
        licenseConnectServices({ licenseKey, publicKey: PUBLIC_KEY, now: NOW }),
      ).toEqual([]);
    });
  });
});

describe("given a license whose term has ended", () => {
  describe("when the install reads its entitlement", () => {
    it("names none", () => {
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals"],
        expiresAt: new Date("2026-09-20T12:00:00.000Z"),
      });

      expect(
        licenseConnectServices({
          licenseKey,
          publicKey: PUBLIC_KEY,
          now: new Date("2026-09-21T12:00:00.000Z"),
        }),
      ).toEqual([]);
    });
  });
});

describe("given an operator who switched Connect off for an audit", () => {
  describe("when the install reads an entitled license", () => {
    it("names none, because the switch only ever refuses", () => {
      env.LANGWATCH_CONNECT_DISABLED = true;
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals"],
      });

      expect(
        licenseConnectServices({ licenseKey, publicKey: PUBLIC_KEY, now: NOW }),
      ).toEqual([]);
    });
  });
});

describe("given an entitled organization nobody has configured", () => {
  describe("when the install asks which services are on", () => {
    it("answers with every entitled service, because entitled means on", async () => {
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals", "managed_models"],
      });

      await expect(
        organizationEnabledConnectServices({
          prisma: prismaWith([
            { license: licenseKey, connectServicesDisabled: [] },
          ]),
          organizationId: ORGANIZATION_ID,
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toEqual(["instant_evals", "managed_models"]);
    });
  });
});

describe("given an administrator who switched one service off", () => {
  describe("when the install asks which services are on", () => {
    it("drops that one and keeps the other", async () => {
      const { licenseKey } = mintLicense({
        connectServices: ["instant_evals", "managed_models"],
      });
      const prisma = prismaWith([
        { license: licenseKey, connectServicesDisabled: ["instant_evals"] },
      ]);

      await expect(
        organizationEnabledConnectServices({
          prisma,
          organizationId: ORGANIZATION_ID,
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toEqual(["managed_models"]);
      await expect(
        connectServiceEnabled({
          prisma,
          organizationId: ORGANIZATION_ID,
          service: "instant_evals",
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given a license reissued while a service stays switched off", () => {
  describe("when the install asks which services are on", () => {
    /** @scenario "A service switched off stays off when the license is reissued" */
    it("keeps the refusal, because it is recorded against the service and not the license", async () => {
      const reissued = mintLicense({
        connectServices: ["instant_evals", "managed_models"],
        expiresAt: new Date("2028-09-19T12:00:00.000Z"),
      });

      await expect(
        organizationEnabledConnectServices({
          prisma: prismaWith([
            {
              license: reissued.licenseKey,
              connectServicesDisabled: ["instant_evals"],
            },
          ]),
          organizationId: ORGANIZATION_ID,
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toEqual(["managed_models"]);
    });
  });
});

describe("given a service switched off on a license that never named it", () => {
  describe("when the install asks which services are on", () => {
    it("still answers none, because the license decides first", async () => {
      const { licenseKey } = mintLicense({ connectServices: [] });

      await expect(
        organizationEnabledConnectServices({
          prisma: prismaWith([
            { license: licenseKey, connectServicesDisabled: ["instant_evals"] },
          ]),
          organizationId: ORGANIZATION_ID,
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toEqual([]);
    });
  });
});

describe("given an install where no license names a hosted service", () => {
  describe("when a worker asks whether to start at all", () => {
    it("answers no", async () => {
      const { licenseKey } = mintLicense({ connectServices: [] });

      await expect(
        installIsEntitled({
          prisma: prismaWith([
            { license: licenseKey, connectServicesDisabled: [] },
          ]),
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an install where one organization holds an entitled license", () => {
  describe("when a worker asks whether to start at all", () => {
    it("answers yes", async () => {
      const offline = mintLicense({ connectServices: [] });
      const connected = mintLicense({ connectServices: ["managed_models"] });

      await expect(
        installIsEntitled({
          prisma: prismaWith([
            { license: offline.licenseKey, connectServicesDisabled: [] },
            { license: connected.licenseKey, connectServicesDisabled: [] },
          ]),
          publicKey: PUBLIC_KEY,
          now: NOW,
        }),
      ).resolves.toBe(true);
    });
  });
});
