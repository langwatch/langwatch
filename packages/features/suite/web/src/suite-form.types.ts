import { z } from "zod";
import { suiteTargetSchema, type SuiteTargetType } from "@langwatch/suite-contract";

export const MAX_REPEAT_COUNT = 5;

export const suiteFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  labels: z.array(z.string()),
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

export interface SuiteFormScenario {
  id: string;
  name: string;
  labels: string[];
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
}

export const suiteFormDefaultValues: SuiteFormData = {
  name: "",
  description: "",
  labels: [],
  selectedScenarioIds: [],
  selectedTargets: [],
  repeatCount: 1,
  simulatorModel: null,
  judgeModel: null,
};
