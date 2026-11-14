/**
 * The documented single-replica root, when a filesystem deployment names none
 * (LANGWATCH_LOCAL_STORAGE_PATH unset). The image creates this folder and the docker compose
 * install mounts one volume here for the app and the workers.
 */
export const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";
