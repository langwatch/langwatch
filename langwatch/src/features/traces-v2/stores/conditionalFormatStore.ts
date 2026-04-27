import { create } from "zustand";

export type FormatColor = "red" | "yellow" | "green";

export type FormatOperator = "gt" | "lt" | "between";

export interface ConditionalFormatRule {
  id: string;
  columnId: string;
  operator: FormatOperator;
  value: number;
  valueTo?: number;
  color: FormatColor;
}

interface ConditionalFormatState {
  rules: ConditionalFormatRule[];

  addRule: (rule: Omit<ConditionalFormatRule, "id">) => void;
  updateRule: (id: string, updates: Partial<Omit<ConditionalFormatRule, "id">>) => void;
  removeRule: (id: string) => void;
  clearRulesForColumn: (columnId: string) => void;
  clearAll: () => void;
  getRulesForColumn: (columnId: string) => ConditionalFormatRule[];
  evaluateCell: (columnId: string, value: number) => FormatColor | null;
}

const COLOR_TOKENS: Record<FormatColor, { bg: string; fg: string }> = {
  red: { bg: "red.subtle", fg: "red.fg" },
  yellow: { bg: "yellow.subtle", fg: "yellow.fg" },
  green: { bg: "green.subtle", fg: "green.fg" },
};

export { COLOR_TOKENS };

const DEFAULT_RULES: ConditionalFormatRule[] = [
  { id: "dur-red", columnId: "duration", operator: "gt", value: 5000, color: "red" },
  { id: "dur-yellow", columnId: "duration", operator: "gt", value: 2000, color: "yellow" },
  { id: "dur-green", columnId: "duration", operator: "lt", value: 1000, color: "green" },
];

let nextId = 1;

function generateId(): string {
  return `cfr-${Date.now()}-${nextId++}`;
}

function loadPersistedRules(): ConditionalFormatRule[] {
  if (typeof window === "undefined") return DEFAULT_RULES;
  try {
    const stored = localStorage.getItem("langwatch:traces-v2:conditionalFormat");
    if (stored) {
      return JSON.parse(stored) as ConditionalFormatRule[];
    }
  } catch {
    // ignore
  }
  return DEFAULT_RULES;
}

function persistRules(rules: ConditionalFormatRule[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      "langwatch:traces-v2:conditionalFormat",
      JSON.stringify(rules),
    );
  } catch {
    // ignore
  }
}

function matchesRule(rule: ConditionalFormatRule, value: number): boolean {
  switch (rule.operator) {
    case "gt":
      return value > rule.value;
    case "lt":
      return value < rule.value;
    case "between":
      return value >= rule.value && value <= (rule.valueTo ?? rule.value);
    default:
      return false;
  }
}

export const useConditionalFormatStore = create<ConditionalFormatState>(
  (set, get) => ({
    rules: loadPersistedRules(),

    addRule: (rule) =>
      set((s) => {
        const newRules = [...s.rules, { ...rule, id: generateId() }];
        persistRules(newRules);
        return { rules: newRules };
      }),

    updateRule: (id, updates) =>
      set((s) => {
        const newRules = s.rules.map((r) =>
          r.id === id ? { ...r, ...updates } : r,
        );
        persistRules(newRules);
        return { rules: newRules };
      }),

    removeRule: (id) =>
      set((s) => {
        const newRules = s.rules.filter((r) => r.id !== id);
        persistRules(newRules);
        return { rules: newRules };
      }),

    clearRulesForColumn: (columnId) =>
      set((s) => {
        const newRules = s.rules.filter((r) => r.columnId !== columnId);
        persistRules(newRules);
        return { rules: newRules };
      }),

    clearAll: () => {
      persistRules([]);
      set({ rules: [] });
    },

    getRulesForColumn: (columnId) => {
      return get().rules.filter((r) => r.columnId === columnId);
    },

    evaluateCell: (columnId, value) => {
      const columnRules = get().rules.filter((r) => r.columnId === columnId);
      // Rules are checked in order — first match wins
      for (const rule of columnRules) {
        if (matchesRule(rule, value)) {
          return rule.color;
        }
      }
      return null;
    },
  }),
);
