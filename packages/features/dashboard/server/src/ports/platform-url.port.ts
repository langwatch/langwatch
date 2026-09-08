/**
 * The address a reader opens a dashboard at. Every `/api/dashboards` answer
 * carries one, and only the deployment knows its own public base URL.
 */
export abstract class PlatformUrlPort {
  abstract linkTo(input: { projectSlug: string; path: string }): string;
}
