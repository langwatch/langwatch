// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: specs/ai-governance/puller-framework/s3-polling.feature */

import { describe, expect, it } from "vitest";

import { findPullCredentialComplaints } from "../../features/ingestion-pull/rules/pull-config-shape.rules.ts";
import { readsAwsAsDeployment } from "../deployment-aws-identity.rules.ts";

describe("readsAwsAsDeployment", () => {
  describe("when the deployment config is missing", () => {
    /** @scenario A keyless S3 polling source is refused when the deployment config is missing */
    it("keeps keyless sources refused", () => {
      const deploymentAwsIdentity = readsAwsAsDeployment({ config: undefined });

      expect(deploymentAwsIdentity).toBe(false);
      expect(
        findPullCredentialComplaints({ adapter: "s3_polling" }, { deploymentAwsIdentity }),
      ).toHaveLength(1);
    });
  });

  describe("when the deployment is hosted", () => {
    it("keeps keyless sources refused", () => {
      expect(readsAwsAsDeployment({ config: { isSaas: true } })).toBe(false);
    });
  });

  describe("when the deployment is self-hosted", () => {
    it("reads keyless sources as the deployment", () => {
      expect(readsAwsAsDeployment({ config: { isSaas: false } })).toBe(true);
    });
  });
});
