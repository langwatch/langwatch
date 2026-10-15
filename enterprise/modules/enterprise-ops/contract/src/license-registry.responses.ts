// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The registry views as an operator reads them: licensing's views plus the names of the people
 * behind them (ADR-180 section 2). A name is null when that person is gone. */
import {
  issuedLicensePageSchema,
  issuedLicenseViewSchema,
  testingLicenseTokenPageSchema,
  testingLicenseTokenViewSchema,
} from "@langwatch/enterprise-licensing-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

const namedIssuedLicenseViewSchemaDefinition = issuedLicenseViewSchema.safeExtend({
  issuedByName: z.string().nullable().optional(),
});
export interface NamedIssuedLicenseViewSchema extends Named<
  typeof namedIssuedLicenseViewSchemaDefinition
> {}
export const namedIssuedLicenseViewSchema: NamedIssuedLicenseViewSchema =
  namedIssuedLicenseViewSchemaDefinition;
export type NamedIssuedLicenseView = z.infer<typeof namedIssuedLicenseViewSchema>;

const namedIssuedLicensePageSchemaDefinition = issuedLicensePageSchema.safeExtend({
  licenses: z.array(namedIssuedLicenseViewSchema),
});
export interface NamedIssuedLicensePageSchema extends Named<
  typeof namedIssuedLicensePageSchemaDefinition
> {}
export const namedIssuedLicensePageSchema: NamedIssuedLicensePageSchema =
  namedIssuedLicensePageSchemaDefinition;
export type NamedIssuedLicensePage = z.infer<typeof namedIssuedLicensePageSchema>;

const namedTestingLicenseTokenViewSchemaDefinition = testingLicenseTokenViewSchema.safeExtend({
  ownerName: z.string().nullable().optional(),
});
export interface NamedTestingLicenseTokenViewSchema extends Named<
  typeof namedTestingLicenseTokenViewSchemaDefinition
> {}
export const namedTestingLicenseTokenViewSchema: NamedTestingLicenseTokenViewSchema =
  namedTestingLicenseTokenViewSchemaDefinition;
export type NamedTestingLicenseTokenView = z.infer<typeof namedTestingLicenseTokenViewSchema>;

const namedTestingLicenseTokenPageSchemaDefinition = testingLicenseTokenPageSchema.safeExtend({
  tokens: z.array(namedTestingLicenseTokenViewSchema),
});
export interface NamedTestingLicenseTokenPageSchema extends Named<
  typeof namedTestingLicenseTokenPageSchemaDefinition
> {}
export const namedTestingLicenseTokenPageSchema: NamedTestingLicenseTokenPageSchema =
  namedTestingLicenseTokenPageSchemaDefinition;
export type NamedTestingLicenseTokenPage = z.infer<typeof namedTestingLicenseTokenPageSchema>;
