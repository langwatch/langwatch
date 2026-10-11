import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Operation } from "./operation.ts";

type EndpointState = { tryOpen: boolean; setTryOpen: (open: boolean) => void; status: string; setStatus: (status: string) => void };

const EndpointStateContext = createContext<EndpointState | null>(null);

/** Shared by the method bar, the rail and the response section: the form and the chosen status. */
export function EndpointStateProvider({ operation, children }: { operation: Operation; children: ReactNode }) {
  const statuses = operation.responses.map((response) => response.status);
  const [tryOpen, setTryOpen] = useState(false);
  const [status, setStatus] = useState(statuses.find((entry) => entry.startsWith("2")) ?? statuses[0] ?? "");
  const value = useMemo(() => ({ tryOpen, setTryOpen, status, setStatus }), [tryOpen, status]);
  return <EndpointStateContext.Provider value={value}>{children}</EndpointStateContext.Provider>;
}

export function useEndpointState(): EndpointState {
  const value = useContext(EndpointStateContext);
  if (!value) throw new Error("useEndpointState needs an EndpointStateProvider");
  return value;
}
