/**
 * Exhaustive check helper - ensures switch statements handle all cases.
 *
 * Use in the `default` case of a switch statement to get a compile-time error
 * if a new case is added to a union type but not handled.
 *
 * @example
 * ```typescript
 * type Status = "active" | "inactive" | "pending";
 *
 * function handleStatus(status: Status): string {
 *   switch (status) {
 *     case "active":
 *       return "Active";
 *     case "inactive":
 *       return "Inactive";
 *     case "pending":
 *       return "Pending";
 *     default:
 *       return assertNever(status); // Compile error if new status added
 *   }
 * }
 * ```
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
