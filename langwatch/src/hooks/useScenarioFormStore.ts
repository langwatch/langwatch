import { create } from "zustand";
import type { ScenarioFormData } from "../components/scenarios/ScenarioForm";

interface ScenarioFormState {
  // The scenario being edited (null for new scenario)
  scenarioId: string | null;
  // Form data that persists across drawer navigation
  formData: ScenarioFormData;
  // Whether the form has unsaved changes
  isDirty: boolean;

  // Actions
  setScenarioId: (id: string | null) => void;
  setFormData: (data: Partial<ScenarioFormData>) => void;
  setIsDirty: (dirty: boolean) => void;
  resetForm: (initialData?: Partial<ScenarioFormData>) => void;
}

const defaultFormData: ScenarioFormData = {
  name: "",
  situation: "",
  criteria: [],
  labels: [],
};

export const useScenarioFormStore = create<ScenarioFormState>((set) => ({
  scenarioId: null,
  formData: { ...defaultFormData },
  isDirty: false,

  setScenarioId: (id) => set({ scenarioId: id }),

  setFormData: (data) =>
    set((state) => ({
      formData: { ...state.formData, ...data },
      isDirty: true,
    })),

  setIsDirty: (dirty) => set({ isDirty: dirty }),

  resetForm: (initialData) =>
    set({
      formData: { ...defaultFormData, ...initialData },
      isDirty: false,
    }),
}));
