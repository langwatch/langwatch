/**
 * Client-side heuristic: is this VK row the auto-provisioned Langy VK?
 *
 * Matches the display name + null principal user. Source-of-truth string is
 * LANGY_VK_DISPLAY_NAME in
 * src/server/services/langy/langyVirtualKey.ts — kept inlined here
 * (not imported) so this stays a client-safe module with no server deps.
 *
 * Shared by the gateway/virtual-keys page (badge + revoke copy) and the
 * Langy sidebar (reading the VK's modelsAllowed to scope its picker).
 */
export function isLangyManagedVk(vk: {
  name: string;
  principalUserId: string | null;
}): boolean {
  return vk.name === "Langy" && vk.principalUserId === null;
}
