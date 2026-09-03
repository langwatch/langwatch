import { z } from "zod";

export const PLATFORM_TOOL_SLUGS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "copilot",
  "code",
] as const;
export const platformToolSlugSchema = z.enum(PLATFORM_TOOL_SLUGS);
export const platformToolPolicySchema = z
  .object({ allowVk: z.boolean(), allowOtelDirect: z.boolean() })
  .strict();
export type PlatformToolSlug = z.infer<typeof platformToolSlugSchema>;
export type PlatformToolPolicy = z.infer<typeof platformToolPolicySchema>;
export type PlatformToolPolicyMap = Record<PlatformToolSlug, PlatformToolPolicy>;

export const PLATFORM_TOOL_POLICY_DEFAULTS: PlatformToolPolicyMap = {
  claude: { allowVk: true, allowOtelDirect: true },
  codex: { allowVk: true, allowOtelDirect: true },
  gemini: { allowVk: true, allowOtelDirect: true },
  opencode: { allowVk: true, allowOtelDirect: true },
  cursor: { allowVk: true, allowOtelDirect: false },
  copilot: { allowVk: true, allowOtelDirect: true },
  code: { allowVk: false, allowOtelDirect: true },
};
export const PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE: Readonly<
  Record<string, PlatformToolSlug>
> = {
  claude_code: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  copilot_cli: "copilot",
  copilot_vscode: "code",
};

export function isPlatformToolSlug(value: string): value is PlatformToolSlug {
  return platformToolSlugSchema.safeParse(value).success;
}
