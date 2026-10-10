import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { SsoTestArrivalCannotCreateOrganizationError } from "@langwatch/identity-contract";
import { generate } from "@langwatch/ksuid";
import {
  ORGANIZATION_KSUID_RESOURCE,
  PricingModel,
  type OrganizationFounding,
  type OrganizationIntent,
} from "@langwatch/organization-contract";
import slugify from "slugify";

import type {
  CreateAndAssignResult,
  OrganizationProvisioningSummary,
  OrganizationMembershipRepository,
} from "../repositories/organization-membership.repository.ts";
import type { OrganizationLifecycleNoticeService } from "./organization-lifecycle-notice.service.ts";
import type { OrganizationMemberChangeNotice } from "./organization-member-admission.service.ts";
import type { OrganizationTestArrivals } from "./organization-membership.service.ts";

/** The KSUID resource an organization's first team is born under. */
const TEAM_KSUID_RESOURCE = "team";

/** Where every new organization is recorded as `lw.organization.created`; prompt seeds on it. */
export type OrganizationCreationNotice = Pick<
  OrganizationLifecycleNoticeService,
  "created" | "reportError"
>;

/**
 * Founding and provisioning organizations: the signup path, the instance-provisioning path
 * with its compensation, self-hosted customers and the provisioning summaries.
 */
export class OrganizationProvisioningService {
  static create(dependencies: {
    repository: OrganizationMembershipRepository;
    creations: OrganizationCreationNotice;
    testArrivals: OrganizationTestArrivals;
    memberNotices: Pick<OrganizationMemberChangeNotice, "memberRemoved">;
  }): OrganizationProvisioningService {
    return new OrganizationProvisioningService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      repository: OrganizationMembershipRepository;
      creations: OrganizationCreationNotice;
      testArrivals: OrganizationTestArrivals;
      memberNotices: Pick<OrganizationMemberChangeNotice, "memberRemoved">;
    },
  ) {}

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  /**
   * Creates an organization with a default team and assigns the given user as
   * admin.
   * they are ledger facts (ADR-092 delivery-plan PR 2) — so they follow it,
   */
  async createAndAssign(params: {
    userId: string;
    orgName?: string;
    phoneNumber?: string;
    signUpData?: Record<string, unknown>;
    primaryIntent?: OrganizationIntent | null;
    userDisplayName?: string | null;
  }): Promise<CreateAndAssignResult> {
    // A TEST SIGN-IN IS NOT A SIGNUP, and this is the one door: onboarding's
    // own mutation delegates here, so a check up there is one this call walks
    // straight past. Creating an organization for the tester strands the real
    // organization's setup inside a second, empty one.
    const arrival = await this.dependencies.testArrivals.standingFor({ userId: params.userId });
    if (arrival.testing) {
      throw new SsoTestArrivalCannotCreateOrganizationError(
        `session opened through connection ${arrival.connectionId}, which is not live`,
      );
    }

    const orgName = params.orgName ?? params.userDisplayName ?? "My Organization";
    const orgId = generate(ORGANIZATION_KSUID_RESOURCE).toString();
    const orgSlug =
      slugify(orgName, { lower: true, strict: true }) + "-" + orgId.substring(orgId.length - 6);

    const teamId = generate(TEAM_KSUID_RESOURCE).toString();
    const teamSlug =
      slugify(orgName, { lower: true, strict: true }) + "-" + teamId.substring(teamId.length - 6);

    const result = await this.repo.createAndAssign({
      userId: params.userId,
      orgId,
      orgName,
      orgSlug,
      teamId,
      teamSlug,
      phoneNumber: params.phoneNumber,
      signUpData: params.signUpData,
      primaryIntent: params.primaryIntent,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    await this.dependencies.creations.created({
      organizationId: result.organization.id,
      organizationName: result.organization.name,
    });

    return result;
  }

  /**
   * Creates an organization with a default team and NO user attached: the
   * self-hosted instance provisioning path ({@link createAndAssign} requires a
   * member to assign, and this path runs before any user exists).
   */
  async createForProvisioning(params: {
    name: string;
    slug?: string;
    id?: string;
  }): Promise<CreateAndAssignResult> {
    const orgId = params.id ?? generate(ORGANIZATION_KSUID_RESOURCE).toString();
    const orgSlug =
      params.slug ??
      slugify(params.name, { lower: true, strict: true }) + "-" + orgId.substring(orgId.length - 6);

    const teamId = generate(TEAM_KSUID_RESOURCE).toString();
    const teamSlug =
      slugify(params.name, { lower: true, strict: true }) +
      "-" +
      teamId.substring(teamId.length - 6);

    const result = await this.repo.createForProvisioning({
      orgId,
      orgName: params.name,
      orgSlug,
      teamId,
      teamSlug,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    try {
      await this.dependencies.creations.created({
        organizationId: result.organization.id,
        organizationName: result.organization.name,
      });
    } catch (error) {
      // The caller has to see what actually went wrong, so a compensation
      // that fails too is reported rather than raised over the top of it.
      try {
        await this.deleteProvisionedOrganization({ organizationId: result.organization.id });
      } catch (compensationError) {
        this.dependencies.creations.reportError(
          compensationError instanceof Error
            ? compensationError
            : new Error(String(compensationError)),
        );
      }

      throw error;
    }

    return result;
  }

  /**
   * The organization a self-hosted licence is issued to, under the id licensing minted, created
   * with its first team exactly as provisioning creates one, then marked as a customer. A
   * redelivered fact finds the row already there and only marks it again.
   */
  async createSelfHostedCustomer({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<void> {
    if (!(await this.findProvisioningSummary(organizationId))) {
      await this.createForProvisioning({ id: organizationId, name });
    }
    await this.repo.markSelfHostedCustomer(organizationId);
  }

  findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    return this.repo.findSelfHostedCustomers();
  }

  findFoundedBetween(input: {
    fromMs: number;
    toMs: number;
    followUntilMs: number;
  }): Promise<OrganizationFounding[]> {
    return this.repo.findFoundedBetween(input);
  }

  findRepresentatives({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; organizationName: string }[]> {
    return this.repo.findRepresentatives(organizationId);
  }

  /** Every organization on the instance, for the instance-admin surface. */
  async listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    return this.repo.findAllProvisioningSummaries();
  }

  /**
   * Compensation for a provisioning run that created the organization but couldn't finish, whose
   * slug would otherwise squat every retry as a 409. Provisioning is the only caller.
   */
  async deleteProvisionedOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    const members = await this.repo.findMembersWithDepartments({ organizationId });
    await this.repo.deleteProvisionedOrganization(organizationId);
    // M8487-REMOVAL-PATHS: every member the deletion took is a removal peers react to.
    for (const { userId } of members) {
      await this.dependencies.memberNotices.memberRemoved({
        organizationId,
        userId,
        removedByUserId: null,
      });
    }
  }

  /** One organization's provisioning summary, or null when the id is unknown. */
  async findProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    try {
      return await this.repo.getProvisioningSummaryById(organizationId);
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "organization_not_found") return null;
      throw error;
    }
  }

  /** One organization's provisioning summary; an unknown id answers the door's `not_found`. */
  async getProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary> {
    const summary = await this.findProvisioningSummary(organizationId);
    if (!summary)
      throw new NotFoundError("not_found", { resource: "Organization", id: organizationId });
    return summary;
  }
}
