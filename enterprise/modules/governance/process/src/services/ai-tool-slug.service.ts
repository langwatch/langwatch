// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A catalogue entry's stable slug: no peer answers this, so it stays in-module. */
import { generate as generateKsuid } from "@langwatch/ksuid";
import type { AiToolSlug } from "../repositories/ai-tool-catalog.repository.ts";

export class GovernanceAiToolSlugService implements AiToolSlug {
  private constructor() {}

  static create(): GovernanceAiToolSlugService {
    return new GovernanceAiToolSlugService();
  }

  generate(displayName: string): string {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const stem = base.length > 0 ? base : "tool";
    const suffix = generateKsuid("governance").toString();
    return `${stem}-${suffix}`;
  }
}
