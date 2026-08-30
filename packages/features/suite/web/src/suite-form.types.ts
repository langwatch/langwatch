import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import {
  CASES_SCOPE,
  type SuiteScope,
  suiteScopeSchema,
  suiteTargetSchema,
  type SuiteTargetType,
} from "@langwatch/suite-contract";

export const MAX_REPEAT_COUNT = 5;

export const suiteFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  labels: z.array(z.string()),
  /**
   * What the plan covers. `cases` is the explicit list below; the dynamic
   * modes resolve against the project at run time, so a case added later is
   * covered without anyone editing the plan.
   */
  scope: suiteScopeSchema,
  selectedScenarioIds: z.array(z.string()).min(1, "At least one scenario is required"),
  selectedTargets: z.array(suiteTargetSchema).min(1, "At least one target is required"),
  repeatCount: z
    .number()
    .int()
    .min(1, `Repeat count must be between 1 and ${MAX_REPEAT_COUNT}`)
    .max(MAX_REPEAT_COUNT, `Repeat count must be between 1 and ${MAX_REPEAT_COUNT}`),
  simulatorModel: z.string().nullable(),
  judgeModel: z.string().nullable(),
});

export type SuiteFormData = z.infer<typeof suiteFormSchema>;

/**
 * The form `useSuiteForm` actually returns.
 *
 * Three type arguments, not one: the schema's INPUT is what the fields hold
 * while a person is typing, and `SuiteFormData` is what the resolver hands a
 * submit. A consumer that writes `UseFormReturn<SuiteFormData>` is naming a
 * different type — the two disagree on every field zod narrows, which is how
 * the run plan editor came to be passing a form nothing would accept.
 */
export type SuiteFormReturn = UseFormReturn<
  z.input<typeof suiteFormSchema>,
  unknown,
  SuiteFormData
>;

/**
 * The rules the Agent Testing run plan editor holds the same form to.
 *
 * It asks for no target: the run dialog is where an agent or a prompt is
 * chosen. It asks for a case list only from a plan that runs one, and for a
 * folder or label scope it asks that the scope name something.
 */
export const planFormSchema = suiteFormSchema
  .extend({
    selectedScenarioIds: z.array(z.string()),
    selectedTargets: z.array(suiteTargetSchema),
  })
  .superRefine((data, ctx) => {
    const empty =
      (data.scope.mode === "cases" && data.selectedScenarioIds.length === 0) ||
      (data.scope.mode === "folders" && data.scope.folderIds.length === 0) ||
      (data.scope.mode === "labels" && data.scope.labels.length === 0);
    if (empty) {
      ctx.addIssue({
        code: "custom",
        path: ["scope"],
        message: "This plan covers no scenario yet",
      });
    }
  });

export interface SuiteFormScenario {
  id: string;
  name: string;
  labels: string[];
  /** The test suite the case is filed in, when the project uses them. */
  folderId?: string | null;
}

export interface SuiteFormAgent {
  id: string;
  name: string;
  type: string;
}

export interface SuiteFormPrompt {
  id: string;
  handle?: string | null;
}

export interface SuiteFormAvailableTarget {
  name: string;
  type: SuiteTargetType;
  referenceId: string;
}

export interface SuiteFormSuite {
  id: string;
  projectId?: string;
  slug?: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  name: string;
  description: string | null;
  labels: string[];
  /** What the stored plan covers. Absent on a suite that predates scopes. */
  scope?: unknown;
  scenarioIds: string[];
  targets: unknown;
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
}

export interface UseSuiteFormParams {
  suite: SuiteFormSuite | null | undefined;
  isOpen: boolean;
  suiteId: string | undefined;
  scenarios: SuiteFormScenario[] | undefined;
  agents: SuiteFormAgent[] | undefined;
  prompts: SuiteFormPrompt[] | undefined;
  /** False for the run plan editor: the run dialog picks the target. */
  picksTargets?: boolean;
  /** What a NEW form starts covering. Stored plans use their own scope. */
  defaultScope?: SuiteScope;
}

export const suiteFormDefaultValues: SuiteFormData = {
  scope: CASES_SCOPE,
  name: "",
  description: "",
  labels: [],
  selectedScenarioIds: [],
  selectedTargets: [],
  repeatCount: 1,
  simulatorModel: null,
  judgeModel: null,
};
