import { z } from "zod";
import { TeamUserRole } from "~/generated/prisma/client";

const bindingRoleSelectionSchema = z.union([
  z
    .enum([TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER])
    .transform((role) => ({ role, customRoleId: void 0 })),
  z
    .string()
    .startsWith("CUSTOM:")
    .min(8)
    .transform((value) => ({
      role: "CUSTOM" as const,
      customRoleId: value.slice(7),
    })),
]);

export type BindingRoleSelection = z.infer<typeof bindingRoleSelectionSchema>;

export function parseBindingRoleSelection(
  value: string,
): BindingRoleSelection | null {
  const parsed = bindingRoleSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function bindingRoleSelectionValue({
  role,
  customRoleId,
}: {
  role: string;
  customRoleId?: string | null;
}): string {
  return role === "CUSTOM" && customRoleId ? `CUSTOM:${customRoleId}` : role;
}

export function bindingRoleItems(
  customRoles: readonly { id: string; name: string }[],
) {
  return [
    { label: "Admin", value: "ADMIN" },
    { label: "Member", value: "MEMBER" },
    { label: "Viewer", value: "VIEWER" },
    ...customRoles.map(({ id, name }) => ({
      label: name,
      value: bindingRoleSelectionValue({ role: "CUSTOM", customRoleId: id }),
    })),
  ];
}
