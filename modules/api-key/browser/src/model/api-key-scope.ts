// API key scope: structurally identical to ScopeTriadEntry, not imported (ui-screen-closure).
// Render surfaces name it once; other modules speak this shape. Checked by unit test.

/** The three scope kinds an API key role binding can sit at. */
export type ApiKeyScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** One scope on a key, as it is selected and as it is sent. */
export interface ApiKeyScopeSelection {
  scopeType: ApiKeyScopeType;
  scopeId: string;
}
