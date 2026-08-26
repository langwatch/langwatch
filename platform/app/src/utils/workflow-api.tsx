import type { QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { useState, type ReactNode } from "react";
import type { WorkflowApiRouter } from "@langwatch/platform-api-contract";

import { createTRPCLinks } from "./trpc-transport";

export const workflowApi = createTRPCReact<WorkflowApiRouter>();

export function WorkflowApiProvider({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  const [client] = useState(() =>
    workflowApi.createClient({
      links: createTRPCLinks(),
    }),
  );

  return (
    <workflowApi.Provider client={client} queryClient={queryClient}>
      {children}
    </workflowApi.Provider>
  );
}
