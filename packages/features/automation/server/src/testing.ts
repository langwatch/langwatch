import {
  AutomationDispatchErrorPort,
  AutomationEmailCapService,
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationRunawayPort,
  AutomationSlackBotTokenDecryptorPort,
  AutomationTestFirePort,
  AutomationPersistCapService,
} from "./index";

export { AutomationPersistCapService };

class TestNotifier extends AutomationGraphNotifierPort {
  async dispatch() {
    return {
      channel: "none" as const,
      didSend: false,
      missingVariables: [],
      renderErrors: [],
    };
  }
}
class TestLogger extends AutomationLoggerPort {
  error(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
}
class TestHeartbeat extends AutomationHeartbeatPort {
  async tryResolveClickHouseClient() {
    return null;
  }
}
class TestSlackTokens extends AutomationSlackBotTokenDecryptorPort {
  tryDecrypt() {
    return null;
  }
}
class TestDispatchErrors extends AutomationDispatchErrorPort {
  isTerminal() {
    return false;
  }
  createTerminal(message: string) {
    return new Error(message);
  }
}
class TestRunaway extends AutomationRunawayPort {
  async countProjectTraces24h() {
    return 0;
  }
  async notificationRecipients() {
    return [];
  }
  async sendLimitEmail() {}
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

class TestFireDelivery extends AutomationTestFirePort {
  async sendEmail(): Promise<void> {}
  async sendSlack(): Promise<void> {}
  async sendSlackBot(): Promise<void> {}
  async sendWebhook(): Promise<{ status: number }> {
    return { status: 200 };
  }
}

export function createAutomationTestFirePort(): AutomationTestFirePort {
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
