import type { ReactNode } from "react";

export type CodeProps = { children: ReactNode };

export const Code = ({ children }: CodeProps) => <code className="ds-code">{children}</code>;
