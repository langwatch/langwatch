export abstract class AutomationClock {
  abstract now(): Date;
}

export abstract class AutomationClockPort extends AutomationClock {}
