import { create } from "zustand";

import { shortId } from "./types";
import type { Preset, TraceConfig } from "./types";
import { builtInPresets } from "./presets";

function loadUserPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("otel-playground:presets");
    return raw ? (JSON.parse(raw) as Preset[]) : [];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: Preset[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem("otel-playground:presets", JSON.stringify(presets));
}

interface PresetStore {
  builtIn: Preset[];
  userPresets: Preset[];
  allPresets: Preset[];
  savePreset(name: string, description: string, config: TraceConfig): void;
  deletePreset(id: string): void;
  duplicatePreset(id: string): void;
  renamePreset(id: string, name: string): void;
  exportPreset(id: string): string;
  importPreset(json: string): void;
  getPreset(id: string): Preset | undefined;
}

export const usePresetStore = create<PresetStore>((set, get) => {
  const userPresets = loadUserPresets();
  return {
    builtIn: builtInPresets,
    userPresets,
    allPresets: [...builtInPresets, ...userPresets],

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
        saveUserPresets(updated);
        return {
          userPresets: updated,
          allPresets: [...state.builtIn, ...updated],
        };
      });
    },

    deletePreset(id) {
      set((state) => {
        const updated = state.userPresets.filter((p) => p.id !== id);
        saveUserPresets(updated);
        return {
          userPresets: updated,
          allPresets: [...state.builtIn, ...updated],
        };
      });
    },

    duplicatePreset(id) {
      const preset = get().allPresets.find((p) => p.id === id);
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
        saveUserPresets(updated);
        return {
          userPresets: updated,
          allPresets: [...state.builtIn, ...updated],
        };
      });
    },

    renamePreset(id, name) {
      set((state) => {
        const updated = state.userPresets.map((p) =>
          p.id === id ? { ...p, name } : p
        );
        saveUserPresets(updated);
        return {
          userPresets: updated,
          allPresets: [...state.builtIn, ...updated],
        };
      });
    },

    exportPreset(id) {
      const preset = get().allPresets.find((p) => p.id === id);
      return preset ? JSON.stringify(preset, null, 2) : "{}";
    },

    importPreset(json) {
      try {
        const preset = JSON.parse(json) as Preset;
        preset.id = shortId();
        preset.builtIn = false;
        set((state) => {
          const updated = [...state.userPresets, preset];
          saveUserPresets(updated);
          return {
            userPresets: updated,
            allPresets: [...state.builtIn, ...updated],
          };
        });
      } catch {
        // Invalid JSON, ignore
      }
    },

    getPreset(id) {
      return get().allPresets.find((p) => p.id === id);
    },
  };
});
