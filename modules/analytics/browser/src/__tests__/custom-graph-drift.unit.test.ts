/**
 * analytics-client copies dashboard's graph unions so a reader needs no dashboard
 * edge; these assertions fail `tsc -b` (the package typecheck) the day either drifts.
 */
import type {
  CustomGraphColorSet,
  CustomGraphInput,
  CustomGraphProps,
  CustomGraphTitleProps,
  CustomGraphType,
} from "@langwatch/analytics-client";
import type {
  ChartColorSet,
  CustomGraphInput as DashboardCustomGraphInput,
  customGraphTypeSchema,
} from "@langwatch/dashboard-contract";
import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import type { CustomGraph } from "../ui/sections/custom-graph.tsx";

describe("analytics-client's copy of dashboard's custom graph types", () => {
  it("names exactly dashboard's graph types", () => {
    expectTypeOf<CustomGraphType>().toExtend<z.infer<typeof customGraphTypeSchema>>();
    expectTypeOf<z.infer<typeof customGraphTypeSchema>>().toExtend<CustomGraphType>();
  });

  it("names exactly dashboard's colour sets", () => {
    expectTypeOf<CustomGraphColorSet>().toExtend<ChartColorSet>();
    expectTypeOf<ChartColorSet>().toExtend<CustomGraphColorSet>();
  });

  it("restates dashboard's parsed graph input", () => {
    expectTypeOf<CustomGraphInput>().toExtend<DashboardCustomGraphInput>();
    expectTypeOf<DashboardCustomGraphInput>().toExtend<CustomGraphInput>();
  });

  it("hands analytics' graph only props it accepts", () => {
    expectTypeOf<CustomGraphTitleProps>().toExtend<SystemStyleObject>();
    expectTypeOf<CustomGraphProps>().toExtend<Parameters<typeof CustomGraph>[0]>();
  });
});
