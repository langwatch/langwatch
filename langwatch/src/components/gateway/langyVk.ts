/**
 * Client-side check: is this VK row the auto-provisioned Langy VK?
 *
 * Reads the `purpose` column persisted on `VirtualKey` (see the
 * `VirtualKeyPurpose` enum in prisma/schema.prisma and the
 * `20260619150000_add_virtual_key_purpose` migration). Previously this was a
 * name + null-principal heuristic, which broke whenever an admin renamed the
 * row or surfaced a translated display string. The column is the only path now.
 *
 * Shared by the gateway/virtual-keys page (badge + revoke copy) and the
 * Langy sidebar (reading the VK's `modelsAllowed` to scope its picker).
 */
export function isLangyManagedVk(vk: { purpose: "user" | "langy" }): boolean {
  return vk.purpose === "langy";
}
