// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";

import { mergeNameParts, namePartsIn, namesAName } from "../rules/scim-name.rules.ts";
import type { ScimCostCenterService } from "./scim-cost-center.service.ts";

/** What one PATCH asks of a directory resource, once every operation is read. */
export interface ScimPatchedUser {
  active: boolean;
  /** Whether any operation turned `active` off, which is what removes access. */
  deactivating: boolean;
  name: string | null;
  userName: string;
  costCenters: (string | null)[];
}

/**
 * Reads a PATCH body into the resource state it asks for, without writing any
 * of it: a body naming `active` twice is one answer, and the caller applies
 * the whole of it once rather than replaying the body operation by operation.
 */
export class ScimUserPatchService {
  private constructor(private readonly costCenters: ScimCostCenterService) {}

  static create(costCenters: ScimCostCenterService): ScimUserPatchService {
    return new ScimUserPatchService(costCenters);
  }

  fold({
    operations,
    active,
    name,
    userName,
  }: {
    operations: ScimPatchOperation[];
    active: boolean;
    name: string | null;
    userName: string;
  }): ScimPatchedUser {
    let deactivating = false;
    const costCenters: (string | null)[] = [];

    for (const operation of operations) {
      const costCenter = this.costCenters.fromPatchOperation(operation);
      if (costCenter.present) {
        costCenters.push(costCenter.value);
      }
      if (operation.op !== "replace") continue;

      const nextActive = activeSaidBy(operation);
      if (nextActive.said) {
        deactivating ||= !nextActive.value;
        active = nextActive.value;
      }

      const parts = namePartsIn({ path: operation.path, value: operation.value });
      if (namesAName(parts)) {
        const merged = mergeNameParts({ current: name ?? "", ...parts });
        if (merged.changed) name = merged.name;
      }

      const nextUserName = userNameSaidBy(operation);
      if (nextUserName.said) {
        userName = nextUserName.value;
      }
    }

    return { active, deactivating, name, userName, costCenters };
  }
}

/** What one operation says about an attribute, where saying nothing is an answer. */
type Said<T> = { said: false } | { said: true; value: T };

const SAID_NOTHING = { said: false } as const;

/**
 * What an operation says about `active`, across the two spellings identity
 * providers use — a scalar at `path: "active"` (Okta, Entra) and an `active`
 * key inside a value object.
 */
function activeSaidBy(operation: ScimPatchOperation): Said<boolean> {
  if (operation.path === "active") {
    return { said: true, value: !(operation.value === false || operation.value === "false") };
  }
  if (isRecord(operation.value) && "active" in operation.value) {
    const value = operation.value.active;

    return { said: true, value: !(value === false || value === "false") };
  }

  return SAID_NOTHING;
}

function userNameSaidBy(operation: ScimPatchOperation): Said<string> {
  if (operation.path === "userName" && typeof operation.value === "string") {
    return { said: true, value: operation.value };
  }
  if (!isRecord(operation.value)) {
    return SAID_NOTHING;
  }

  const userName = operation.value.userName;

  return typeof userName === "string" ? { said: true, value: userName } : SAID_NOTHING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
