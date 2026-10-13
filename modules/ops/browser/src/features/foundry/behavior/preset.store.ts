import { defineSlice } from "@langwatch/browser-host/global-store";

import { builtInPresets } from "../model/foundry-presets.ts";
import type { Preset, TraceConfig } from "../model/foundry-types.ts";
import { shortId } from "../model/foundry-types.ts";

interface PresetStore {
  builtIn: Preset[];
  userPresets: Preset[];
  savePreset(name: string, description: string, config: TraceConfig): void;
  deletePreset(id: string): void;
  duplicatePreset(id: string): void;
  renamePreset(id: string, name: string): void;
  exportPreset(id: string): string;
  importPreset(json: string): void;
  getPreset(id: string): Preset | undefined;
}

const allPresets = ({ builtIn, userPresets }: PresetStore) => [...builtIn, ...userPresets];

/** User presets persist per reader (record §10.2); built-ins always come from code. */
export const usePresetStore = defineSlice<PresetStore>({
  name: "ops:foundry-presets",
  persist: { partialize: ({ userPresets }) => ({ userPresets }) },
  create: (set, get) => ({
    builtIn: builtInPresets,
    userPresets: [],

    savePreset(name, description, config) {
      const preset: Preset = {
        id: shortId(),
        name,
        description,
        builtIn: false,
        config: structuredClone(config),
      };
      set((state) => {
        const updated = [...state.userPresets, preset];
        return { userPresets: updated };
      });
    },

    deletePreset(id) {
      set((state) => {
        const updated = state.userPresets.filter((p) => p.id !== id);
        return { userPresets: updated };
      });
    },

    duplicatePreset(id) {
      const preset = allPresets(get()).find((p) => p.id === id);
      if (!preset) return;
      const dup: Preset = {
        id: shortId(),
        name: `${preset.name} (copy)`,
        description: preset.description,
        builtIn: false,
        config: structuredClone(preset.config),
      };
      set((state) => {
        const updated = [...state.userPresets, dup];
        return { userPresets: updated };
      });
    },

    renamePreset(id, name) {
      set((state) => {
        const updated = state.userPresets.map((p) => (p.id === id ? { ...p, name } : p));
        return { userPresets: updated };
      });
    },

    exportPreset(id) {
      const preset = allPresets(get()).find((p) => p.id === id);
      return preset ? JSON.stringify(preset, null, 2) : "{}";
    },

    importPreset(json) {
      try {
        const preset = JSON.parse(json) as Preset;
        preset.id = shortId();
        preset.builtIn = false;
        set((state) => {
          const updated = [...state.userPresets, preset];
          return { userPresets: updated };
        });
      } catch {
        // Invalid JSON, ignore
      }
    },

    getPreset(id) {
      return allPresets(get()).find((p) => p.id === id);
    },
  }),
});
