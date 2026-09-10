import {
  AutomationDispatchError,
  AutomationEmailCapService,
  AutomationGraphNotifier,
  AutomationLogger,
  AutomationHeartbeat,
  AutomationRunaway,
  AutomationRunawayNotice,
  AutomationRunawaySignals,
  AutomationSlackBotTokenDecryptor,
  AutomationTestFire,
  AutomationPersistCapService,
} from "./index.ts";

export { AutomationPersistCapService };

/**
 * The graph-alert vertical's fixtures, so a composition root can prove its own
 * wiring against the same rows the feature's own suite uses rather than
 * inventing a second stand-in that agrees with nothing.
 */
export {
  BreachingAnalytics,
  createGraphActivityPrismaDouble,
  customGraphRow,
  FrozenClock,
  FROZEN_NOW,
  graphTriggerRow,
  OneProject,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "./fixtures/graph-activity.fixture.ts";

class TestNotifier implements AutomationGraphNotifier {
  async dispatch() {
    return {
      channel: "none" as const,
      didSend: false,
      missingVariables: [],
      renderErrors: [],
    };
  }
}
class TestLogger extends AutomationLogger {
  error(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
}
class TestHeartbeat extends AutomationHeartbeat {
  async tryResolveClickHouseClient() {
    return null;
  }
}
class TestSlackTokens extends AutomationSlackBotTokenDecryptor {
  tryDecrypt() {
    return null;
  }
}
class TestDispatchErrors extends AutomationDispatchError {
  isTerminal() {
    return false;
  }
  createTerminal(message: string) {
    return new Error(message);
  }
}
class TestRunaway
  extends AutomationRunaway
  implements AutomationRunawayNotice, AutomationRunawaySignals
{
  async countProjectTraces24h() {
    return 0;
  }
  async notificationRecipients() {
    return [];
  }
  async sendLimitEmail() {}
  async resolveNextStep() {
    return undefined;
  }
  async tryClaimOnce() {
    return null;
  }
  async releaseClaim() {}
  async projectName() {
    return "Project";
  }
  async automationUrl() {
    return "http://automation.test";
  }
  onCeilingBreach() {}
  onAutoPaused() {}
  onContainmentFailed() {}
  error() {}
  info() {}
}

class TestFireDelivery extends AutomationTestFire {
  async sendEmail(): Promise<void> {}
  async sendSlack(): Promise<void> {}
  async sendSlackBot(): Promise<void> {}
  async sendWebhook(): Promise<{ status: number }> {
    return { status: 200 };
  }
}

export function createAutomationTestFirePort(): AutomationTestFire {
  return new TestFireDelivery();
}

/** Complete deterministic graph capability for service tests that do not
 * exercise analytics/provider delivery. */
export function createAutomationTestRuntime() {
  return {
    emailCaps: AutomationEmailCapService.create({ store: null }),
    projects: {} as never,
    analytics: {} as never,
    notifier: new TestNotifier(),
    baseHost: "http://automation.test",
    logger: new TestLogger(),
    slackTokens: new TestSlackTokens(),
    dispatchErrors: new TestDispatchErrors(),
    heartbeat: new TestHeartbeat(),
    runaway: new TestRunaway(),
    testFire: new TestFireDelivery(),
  };
}
