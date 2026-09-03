import { describe, expect, it, vi } from "vitest";
import { JoinRequestAudiencePort } from "../../ports/join-request-audience.port";
import { JoinRequestMailPort } from "../../ports/join-request-mail.port";
import { JoinRequestNotificationService } from "../join-request-notification.service";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 */
const ORGANIZATION = "organization_acme";
const REQUEST = "joinreq_1";
const REQUESTER = "user_ada";

class Audience extends JoinRequestAudiencePort {
  constructor(
    private readonly answers: {
      requesterId?: string | null;
      organizationName?: string | null;
      admins?: string[];
      displayName?: string | null;
      email?: string | null;
    } = {},
  ) {
    super();
  }

  async tryFindRequesterId(): Promise<string | null> {
    return "requesterId" in this.answers ? (this.answers.requesterId ?? null) : REQUESTER;
  }

  async tryFindOrganizationName(): Promise<string | null> {
    return "organizationName" in this.answers ? (this.answers.organizationName ?? null) : "Acme";
  }

  async findAdminEmails(): Promise<string[]> {
    return this.answers.admins ?? ["admin@acme.example"];
  }

  async tryFindDisplayName(): Promise<string | null> {
    return "displayName" in this.answers ? (this.answers.displayName ?? null) : "Ada Lovelace";
  }

  async tryFindEmail(): Promise<string | null> {
    return "email" in this.answers ? (this.answers.email ?? null) : "ada@acme.example";
  }
}

class RecordingMail extends JoinRequestMailPort {
  readonly stillWaiting: { adminEmail: string; organizationName: string }[] = [];
  readonly expired: { requesterEmail: string; organizationName: string }[] = [];

  constructor(private readonly bouncing: ReadonlySet<string> = new Set()) {
    super();
  }

  async sendStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void> {
    if (this.bouncing.has(input.adminEmail)) throw new Error("550 mailbox unavailable");
    this.stillWaiting.push(input);
  }

  async sendExpired(input: { requesterEmail: string; organizationName: string }): Promise<void> {
    this.expired.push(input);
  }
}

describe("given an organization with several admins", () => {
  describe("when the reminder cannot be delivered to one of them", () => {
    /** @scenario "One bouncing admin address does not silence the rest" */
    it("still sends to the others", async () => {
      const mail = new RecordingMail(new Set(["bouncing@acme.example"]));
      const service = JoinRequestNotificationService.create({
        audience: new Audience({
          admins: ["bouncing@acme.example", "second@acme.example", "third@acme.example"],
        }),
        mail,
      });

      await service.requestStillWaiting({ joinRequestId: REQUEST, organizationId: ORGANIZATION });

      expect(mail.stillWaiting.map((sent) => sent.adminEmail)).toEqual([
        "second@acme.example",
        "third@acme.example",
      ]);
    });

    /** @scenario "One bouncing admin address does not silence the rest" */
    it("never fails the wake that asked for it", async () => {
      const mail = new RecordingMail(new Set(["only@acme.example"]));
      const service = JoinRequestNotificationService.create({
        audience: new Audience({ admins: ["only@acme.example"] }),
        mail,
      });

      // The durable fact is the request; the notification is a courtesy. A
      // wake that threw would be retried, and the retry would send the one
      // reminder a second time to every admin whose address did work.
      await expect(
        service.requestStillWaiting({ joinRequestId: REQUEST, organizationId: ORGANIZATION }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given an organization whose name no longer reads", () => {
  describe("when the reminder is addressed", () => {
    /** @scenario "One bouncing admin address does not silence the rest" */
    it("falls back to a generic name rather than sending nothing", async () => {
      const mail = new RecordingMail();
      const service = JoinRequestNotificationService.create({
        audience: new Audience({ organizationName: null, displayName: null }),
        mail,
      });

      await service.requestStillWaiting({ joinRequestId: REQUEST, organizationId: ORGANIZATION });

      expect(mail.stillWaiting).toEqual([
        {
          adminEmail: "admin@acme.example",
          organizationName: "your organization",
          requesterName: "A colleague",
        },
      ]);
    });
  });
});

describe("given a request whose requester has no address on file", () => {
  describe("when the lapse notice would be sent", () => {
    /** @scenario "A notification with nobody to address is not sent" */
    it("sends nothing", async () => {
      const mail = new RecordingMail();
      const service = JoinRequestNotificationService.create({
        audience: new Audience({ email: null }),
        mail,
      });

      await service.requestExpired({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        requesterUserId: REQUESTER,
      });

      expect(mail.expired).toEqual([]);
    });
  });
});

describe("given a reminder wake for a request the fold has not written", () => {
  describe("when the requester cannot be read", () => {
    /** @scenario "A notification with nobody to address is not sent" */
    it("asks nobody for an address and sends nothing", async () => {
      const mail = new RecordingMail();
      const audience = new Audience({ requesterId: null });
      const admins = vi.spyOn(audience, "findAdminEmails");
      const service = JoinRequestNotificationService.create({ audience, mail });

      await service.requestStillWaiting({ joinRequestId: REQUEST, organizationId: ORGANIZATION });

      expect(mail.stillWaiting).toEqual([]);
      expect(admins).not.toHaveBeenCalled();
    });
  });
});
