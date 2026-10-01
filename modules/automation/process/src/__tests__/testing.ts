import type { AutomationRunawaySignals } from "../app/automation.members.ts";
import {
  AutomationDispatchError,
  AutomationLogger,
  AutomationHeartbeat,
} from "../app/automation.members.ts";
import type { AutomationGraphNotifier, AutomationRunawayNotice } from "../index.ts";
import { AutomationTestFire } from "../index.ts";
import { AutomationRunawayRepository } from "../repositories/automation-runaway.repository.ts";
import { AutomationSlackConnectionService } from "../services/automation-slack-connection.service.ts";
import { AutomationEmailCapService } from "../services/email-cap.service.ts";
import { SlackDestinationService } from "../services/slack-destination.service.ts";

/** A cipher that stores what it is given, for fixtures that never read a real secret. */
const PLAIN_CRYPTO = { encrypt: (value: string) => value, decrypt: (value: string) => value };

/** Slack as a project with no connections: every destination is the automation's own. */
export function createTestSlackDestinations(): SlackDestinationService {
  return SlackDestinationService.create({
    slack: { findUsableSlackSecret: async () => [] },
    crypto: PLAIN_CRYPTO,
  });
}

/** Saves that name no connection and claims that land nowhere. */
export function createTestSlackConnections(): AutomationSlackConnectionService {
  return AutomationSlackConnectionService.create({
    slack: {
      getUsableSlackConnection: () =>
        Promise.reject(new Error("no Slack connection in this fixture")),
      findOrCreateSlackConnectionForSecret: () =>
        Promise.reject(new Error("no Slack connection in this fixture")),
      claimConnection: async () => {},
      releaseConnection: async () => {},
    },
    projects: { getOrganizationId: async () => "organization-test" },
    crypto: PLAIN_CRYPTO,
  });
}

/**
 * The graph-alert vertical's fixtures, so a composition root can prove its own
 * wiring against the same rows the feature's own suite uses rather than
 * inventing a second stand-in that agrees with nothing.
 */
export {
  breachingAnalytics,
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
import { MemoryAutomationEmailCapRepository } from "../repositories/memory/memory.automation-email-cap.repository.ts";

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
  async findClickHouseClient(): Promise<null> {
    return null;
  }
}
class TestDispatchErrors extends AutomationDispatchError {
  isTerminal(): boolean {
    return false;
  }
  createTerminal(message: string): unknown {
    return new Error(message);
  }
}
class TestRunaway
  extends AutomationRunawayRepository
  implements AutomationRunawayNotice, AutomationRunawaySignals
{
  async countProjectTraces24h() {
    return 0;
  }
  async notificationRecipients() {
    return [];
  }
  async sendLimitEmail() {}
  async findNextStep() {
    return undefined;
  }
  async claimOnce() {
    return "already-claimed" as const;
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

export function createAutomationTestFire(): AutomationTestFire {
  return new TestFireDelivery();
}

/** Complete deterministic graph capability for service tests that do not
 * exercise analytics/provider delivery. */
export function createAutomationTestRuntime(): {
  emailCaps: AutomationEmailCapService;
  projects: never;
  analytics: never;
  notifier: TestNotifier;
  baseHost: string;
  logger: TestLogger;
  slackDestinations: SlackDestinationService;
  dispatchErrors: TestDispatchErrors;
  heartbeat: TestHeartbeat;
  runaway: TestRunaway;
  testFire: TestFireDelivery;
} {
  return {
    emailCaps: AutomationEmailCapService.create({
      store: MemoryAutomationEmailCapRepository.create(),
      fallback: MemoryAutomationEmailCapRepository.create(),
    }),
    projects: {} as never,
    analytics: {} as never,
    notifier: new TestNotifier(),
    baseHost: "http://automation.test",
    logger: new TestLogger(),
    slackDestinations: createTestSlackDestinations(),
    dispatchErrors: new TestDispatchErrors(),
    heartbeat: new TestHeartbeat(),
    runaway: new TestRunaway(),
    testFire: new TestFireDelivery(),
  };
}
