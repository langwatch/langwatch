import { makeRequest } from "./langwatch-api.js";

export interface TriggerSummary {
  id: string;
  name: string;
  action: string;
  actionParams: Record<string, unknown>;
  filters: Record<string, unknown>;
  active: boolean;
  message: string | null;
  alertType: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listTriggers(): Promise<TriggerSummary[]> {
  return makeRequest("GET", "/api/triggers") as Promise<TriggerSummary[]>;
}

export async function getTrigger(id: string): Promise<TriggerSummary> {
  return makeRequest("GET", `/api/triggers/${encodeURIComponent(id)}`) as Promise<TriggerSummary>;
}

export async function createTrigger(data: {
  name: string;
  action: string;
  actionParams?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  message?: string;
  alertType?: string;
}): Promise<TriggerSummary> {
  return makeRequest("POST", "/api/triggers", data) as Promise<TriggerSummary>;
}

export async function updateTrigger(params: {
  id: string;
  name?: string;
  active?: boolean;
  message?: string | null;
  alertType?: string | null;
}): Promise<TriggerSummary> {
  const { id, ...data } = params;
  return makeRequest("PATCH", `/api/triggers/${encodeURIComponent(id)}`, data) as Promise<TriggerSummary>;
}

export async function deleteTrigger(id: string): Promise<{ id: string; deleted: boolean }> {
  return makeRequest("DELETE", `/api/triggers/${encodeURIComponent(id)}`) as Promise<{ id: string; deleted: boolean }>;
}
