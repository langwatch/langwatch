// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type DigestMyTest,
  type DigestMyTests,
  DigestOperatorAddressMissingError,
  DigestPersonNotFoundError,
  DigestPublicBaseUrlMissingError,
  type DigestTestDelivery,
  type DigestTestsFor,
  type DigestTestTemplate,
} from "@langwatch/enterprise-digest-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { UserApi } from "@langwatch/user-contract";

import { classifyDigestTestRefusal } from "../rules/digest-test.rules.ts";
import type { DigestSendService } from "./digest-send.service.ts";

const logger = createLogger("langwatch:digest");

type Deps = Readonly<{
  /** One organization's test, sent as the send service sends it. */
  sends: Pick<DigestSendService, "sendTest">;
  /** The operator's address, and the person a test is of, by address. */
  users: Pick<UserApi, "findById" | "findByEmail">;
  organizations: Readonly<{
    /** The organizations a person is an active member of. */
    organizationIdsForMember: OrganizationApi["organizationIdsForMember"];
    /** Those organizations' names, the install's hidden system one left out as `listAllIds` does. */
    findForOperators: OrganizationApi["findForOperators"];
  }>;
}>;

/**
 * Staff test sends across a person's organizations: one test each, mailed to the operator, with
 * an outcome per organization, so one quiet or failing organization does not stop the rest.
 */
export class DigestTestSendService {
  static create(deps: Deps): DigestTestSendService {
    return new DigestTestSendService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * The operator's own week in every organization the weekly send would mail them for (active
   * memberships, the system organization left out), as tests, by name. A refusal that means nothing would go out is a skip; any
   * other is logged and reported, and the rest still go. No address fails the whole call.
   */
  async sendMyTests({ operatorId }: { operatorId: string }): Promise<DigestMyTests> {
    const operator = await this.deps.users.findById({ id: operatorId });
    if (!operator?.email) throw new DigestOperatorAddressMissingError();
    return {
      organizations: await this.#testsOf({ userId: operatorId, operatorId, template: "auto" }),
    };
  }

  /**
   * The same tests of another person, found by address, mailed to the operator, or with
   * `deliverTo: "person"` to that person's own address, never to one typed in; `template` is what
   * they would get ("auto") or one forced, skipped without its data.
   */
  async sendTestFor({
    email,
    template,
    operatorId,
    deliverTo = "me",
  }: {
    email: string;
    template: DigestTestTemplate;
    operatorId: string;
    deliverTo?: DigestTestDelivery;
  }): Promise<DigestTestsFor> {
    const operator = await this.deps.users.findById({ id: operatorId });
    if (!operator?.email) throw new DigestOperatorAddressMissingError();
    const person = await this.deps.users.findByEmail({ email });
    if (!person) throw new DigestPersonNotFoundError();
    return {
      // The matched account's own address, so a match that differs from what was typed shows.
      person: { name: person.name, email: person.email ?? email },
      organizations: await this.#testsOf({ userId: person.id, operatorId, template, deliverTo }),
    };
  }

  /** One test per organization the person is an active member of, system one left out, by name. */
  async #testsOf({
    userId,
    operatorId,
    template,
    deliverTo = "me",
  }: {
    userId: string;
    operatorId: string;
    template: DigestTestTemplate;
    deliverTo?: DigestTestDelivery;
  }): Promise<DigestMyTest[]> {
    const organizationIds = await this.deps.organizations.organizationIdsForMember({ userId });
    if (organizationIds.length === 0) return [];
    const named = await this.deps.organizations.findForOperators({ organizationIds });
    const organizations: DigestMyTest[] = [];
    for (const { id, name } of named.toSorted((a, b) => a.name.localeCompare(b.name))) {
      organizations.push(
        await this.#test({
          organizationId: id,
          organizationName: name,
          userId,
          operatorId,
          template,
          deliverTo,
        }),
      );
    }
    return organizations;
  }

  async #test({
    organizationId,
    organizationName,
    userId,
    operatorId,
    template,
    deliverTo = "me",
  }: {
    organizationId: string;
    organizationName: string;
    userId: string;
    operatorId: string;
    template: DigestTestTemplate;
    deliverTo?: DigestTestDelivery;
  }): Promise<DigestMyTest> {
    const about = { organizationId, organizationName };
    try {
      const templateId = await this.deps.sends.sendTest({
        organizationId,
        userId,
        operatorId,
        template,
        deliverTo,
      });
      return { outcome: "sent", ...about, templateId };
    } catch (error) {
      const reason = classifyDigestTestRefusal(error);
      // A forced template with nothing to show has no data here, not an empty week.
      if (reason === "nothing_to_send" && template !== "auto") {
        return { outcome: "skipped", ...about, reason: "no_data_for_template" };
      }
      if (reason) return { outcome: "skipped", ...about, reason };
      // No public base URL fails every organization alike, before any mail: the call fails.
      if (error instanceof DigestPublicBaseUrlMissingError) throw error;
      logger.error(
        { error, organizationId, userId, operatorId },
        "the digest could not send a test",
      );
      return { outcome: "failed", ...about };
    }
  }
}
