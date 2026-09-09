/** The package clock keeps time-dependent read and persistence rules testable. */
export abstract class CodingAgentClockPort {
  abstract nowMs(): number;
}
