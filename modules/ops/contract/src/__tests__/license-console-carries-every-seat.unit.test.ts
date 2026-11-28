/**
 * Guard: the admin console's copy of the licence registry contract carries every seat kind a
 * signed licence sells, on every issue path and every view (licensing.feature).
 */
import { licenseSeatsShape } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { activationCodeViewSchema, issueActivationCodeInputSchema } from "../activation-code.ts";
import {
  issuedLicenseViewSchema,
  issueLicenseInputSchema,
  reissueLicenseInputSchema,
} from "../features/license-registry/license-registry.ts";

const SEATS = Object.keys(licenseSeatsShape);

const PATHS = {
  "issuing a licence": issueLicenseInputSchema.shape,
  "reissuing a licence": reissueLicenseInputSchema.shape,
  "issuing an activation code": issueActivationCodeInputSchema.shape,
  "the licence view": issuedLicenseViewSchema.shape,
  "the activation code view": activationCodeViewSchema.shape,
};

describe("the admin console's licence registry contract", () => {
  /** @scenario Every seat kind a licence sells is accepted by every issue path */
  it.each(Object.entries(PATHS))("%s carries every seat kind a licence sells", (_, shape) => {
    expect(SEATS.filter((seat) => !(seat in shape))).toEqual([]);
  });
});
