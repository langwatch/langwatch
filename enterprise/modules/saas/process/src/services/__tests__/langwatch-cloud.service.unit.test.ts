// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { LangWatchCloudService } from "../langwatch-cloud.service.ts";

describe("LangWatchCloudService", () => {
  describe("when the process says it is LangWatch Cloud", () => {
    /** @scenario "Cloud answers its own routes" */
    it("lets the caller through", () => {
      expect(() => LangWatchCloudService.create({ isSaas: true }).assertCloud()).not.toThrow();
    });
  });

  describe("when the process is any other deployment", () => {
    /** @scenario "Any other deployment refuses Cloud's routes by code" */
    it("refuses with the cloud-only code", () => {
      expect(() => LangWatchCloudService.create({ isSaas: false }).assertCloud()).toThrow(
        expect.objectContaining({ code: "langwatch_cloud_only", httpStatus: 404 }),
      );
    });
  });
});
