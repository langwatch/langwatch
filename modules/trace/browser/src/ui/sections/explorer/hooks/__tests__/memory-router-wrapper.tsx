import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

export function MemoryRouterWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
