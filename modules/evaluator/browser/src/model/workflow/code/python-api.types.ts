export interface PyMember {
  name: string;
  kind: "function" | "class" | "constant" | "method" | "property";
  signature?: string;
  doc?: string;
}

export interface PyModule {
  name: string;
  doc: string;
  members: PyMember[];
}
