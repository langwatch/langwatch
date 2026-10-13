import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isLocalDevHost,
  isUntrustedCertError,
  trustLocalDevCa,
  untrustedCertHint,
} from "../localDevCa";

const CA = "-----BEGIN CERTIFICATE-----\nlocal\n-----END CERTIFICATE-----\n";

describe("isLocalDevHost", () => {
  it.each(["localhost", "LOCALHOST", "app.wt.langwatch.localhost", "a.localhost."])(
    "treats %s as local",
    (host) => {
      expect(isLocalDevHost(host)).toBe(true);
    },
  );

  it.each(["app.langwatch.ai", "localhost.evil.com", "notlocalhost", "127.0.0.1"])(
    "treats %s as remote",
    (host) => {
      expect(isLocalDevHost(host)).toBe(false);
    },
  );
});

describe("trustLocalDevCa", () => {
  let dir: string;
  let caPath: string;
  const tlsApi = () => ({
    getCACertificates: vi.fn(() => ["root-a", "root-b"]),
    setDefaultCACertificates: vi.fn(),
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-local-ca-"));
    caPath = path.join(dir, `ca-${Math.random().toString(36).slice(2)}.pem`);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given an https localhost endpoint and the CA file", () => {
    it("adds the CA to the default roots, keeping the existing ones, once", () => {
      fs.writeFileSync(caPath, CA);
      const api = tlsApi();
      const endpoint = "https://app.wt.langwatch.localhost:1355";

      expect(trustLocalDevCa({ endpoint, caPath, tlsApi: api })).toBe("trusted");
      expect(api.setDefaultCACertificates).toHaveBeenCalledWith(["root-a", "root-b", CA]);
      expect(trustLocalDevCa({ endpoint, caPath, tlsApi: api })).toBe("already-trusted");
      expect(api.setDefaultCACertificates).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a remote endpoint", () => {
    it("leaves the roots alone", () => {
      fs.writeFileSync(caPath, CA);
      const api = tlsApi();

      expect(trustLocalDevCa({ endpoint: "https://app.langwatch.ai", caPath, tlsApi: api })).toBe(
        "not-local",
      );
      expect(api.setDefaultCACertificates).not.toHaveBeenCalled();
    });
  });

  describe("given a plain http localhost endpoint", () => {
    it("leaves the roots alone", () => {
      fs.writeFileSync(caPath, CA);
      const api = tlsApi();

      expect(trustLocalDevCa({ endpoint: "http://localhost:5560", caPath, tlsApi: api })).toBe(
        "not-local",
      );
      expect(api.setDefaultCACertificates).not.toHaveBeenCalled();
    });
  });

  describe("given no CA file", () => {
    it("leaves the roots alone", () => {
      const api = tlsApi();

      expect(trustLocalDevCa({ endpoint: "https://localhost:1355", caPath, tlsApi: api })).toBe(
        "no-ca",
      );
      expect(api.setDefaultCACertificates).not.toHaveBeenCalled();
    });
  });

  describe("given a Node without setDefaultCACertificates", () => {
    it("reports it unsupported", () => {
      fs.writeFileSync(caPath, CA);

      expect(trustLocalDevCa({ endpoint: "https://localhost:1355", caPath, tlsApi: {} })).toBe(
        "unsupported",
      );
    });
  });
});

describe("untrustedCertHint", () => {
  it("names NODE_EXTRA_CA_CERTS for a certificate failure nested in the fetch cause", () => {
    const cause = Object.assign(new Error("self-signed certificate in certificate chain"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    const error = Object.assign(new TypeError("fetch failed"), { cause });

    expect(isUntrustedCertError(error)).toBe(true);
    expect(untrustedCertHint(error)).toContain("NODE_EXTRA_CA_CERTS=~/.portless/ca.pem");
  });

  it("says nothing for other network failures", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });

    expect(untrustedCertHint(error)).toBeUndefined();
  });
});
