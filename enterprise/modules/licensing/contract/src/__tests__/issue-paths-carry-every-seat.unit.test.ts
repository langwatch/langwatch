/**
 * Guard: a seat kind a signed licence carries is accepted by every way of issuing one and shown by
 * every registry view, so the next seat kind cannot be wired into the signer alone.
 */
import { licenseSeatsShape } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { activationCodeViewSchema, issueActivationCodeInputSchema } from "../activation-code.ts";
import { issuedLicenseViewSchema } from "../issued-license.ts";
import { issueLicenseInputSchema, reissueLicenseInputSchema } from "../license-registry.ts";
import { generateLicenseKeyInputSchema } from "../license.commands.ts";

const SEATS = Object.keys(licenseSeatsShape);

const PATHS = {
  "issuing a licence": issueLicenseInputSchema.shape,
  "reissuing a licence": reissueLicenseInputSchema.shape,
  "issuing an activation code": issueActivationCodeInputSchema.shape,
  "minting a key": generateLicenseKeyInputSchema.shape,
  "the registry row view": issuedLicenseViewSchema.shape,
  "the activation code view": activationCodeViewSchema.shape,
};

describe("every issue path and registry view", () => {
  /** @scenario Every seat kind a licence sells is accepted by every issue path */
  it.each(Object.entries(PATHS))("%s carries every seat kind a licence sells", (_, shape) => {
    expect(SEATS.filter((seat) => !(seat in shape))).toEqual([]);
  });
});
