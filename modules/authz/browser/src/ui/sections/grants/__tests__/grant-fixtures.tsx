import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { GrantRow } from "../../../../model/grants/grants.ts";

export function renderInChakra(element: ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);
}

export function grantRow(over: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "gr-1",
    principal: { type: "user", id: "u-sam", name: "Sam" },
    role: { id: "viewer", name: "Viewer", builtIn: true },
    scope: { type: "team", id: "team-1", name: "Platform" },
    status: "active",
    expiresAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}
