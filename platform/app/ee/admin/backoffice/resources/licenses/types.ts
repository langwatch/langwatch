import {
  CONNECT_SERVICES,
  type ConnectService,
} from "@ee/licensing/connect/services";
import { HOSTED_SERVICES } from "~/components/settings/connect/connectStatus";
import type { RouterOutputs } from "~/utils/api";

/**
 * The services an operator can put on a license, named the way the registry,
 * the install's own Connect page and the hosted routes name them. Both come
 * from where they are defined, so the backoffice cannot offer a service the
 * rest of the system does not know or label one differently.
 */
export const SERVICES = CONNECT_SERVICES;

export type Service = ConnectService;

export const SERVICE_LABELS: Record<Service, string> = Object.fromEntries(
  HOSTED_SERVICES.map((service) => [service.id, service.name]),
) as Record<Service, string>;

export type License =
  RouterOutputs["licenseRegistry"]["getAll"]["licenses"][number];
