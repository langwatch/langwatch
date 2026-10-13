/**
 * The hosted provider slot a connected install's gateway adds for one organization (ADR-156 §8).
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import type { ConnectUpstream, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { MemoryGatewayConnectUpstreamRepository } from "../../repositories/memory/memory.gateway-connect-upstream.repository.ts";
import {
  CONNECT_LANGWATCH_PROVIDER_ID,
  GatewayConnectUpstreamService,
} from "../gateway-connect-upstream.service.ts";

const upstream = {
  organizationId: "org-1",
  baseUrl: "https://gateway.langwatch.ai/",
  token: `lwl_${"a1".repeat(32)}`,
  instanceId: "instance-1",
};

/** Licensing's read as gateway sees it: what it serves now, or a refusal. */
function harness(findConnectUpstream: LicensingApi["findConnectUpstream"] = async () => [served]) {
  const repository = MemoryGatewayConnectUpstreamRepository.create();
  return {
    repository,
    service: GatewayConnectUpstreamService.create({
      repository,
      licensing: { findConnectUpstream },
    }),
  };
}

const served: ConnectUpstream = {
  baseUrl: upstream.baseUrl,
  token: upstream.token,
  instanceId: upstream.instanceId,
};

describe("the hosted provider slot of a connected install", () => {
  /** @scenario "Gateway keeps the install's hosted provider slot from licensing's upstream" */
  it("pulls the license token from licensing on the set fact and reads it back whole", async () => {
    const { service } = harness();

    await service.setFromLicensing({ organizationId: "org-1" });

    expect(await service.findForOrganization("org-1")).toEqual([upstream]);
  });

  /** @scenario "Gateway leaves the hosted provider slot unset when licensing serves no upstream" */
  it("leaves the slot unset when licensing serves no upstream any more", async () => {
    let answer: ConnectUpstream[] = [served];
    const { service } = harness(async () => answer);
    await service.setFromLicensing({ organizationId: "org-1" });

    answer = [];
    await service.setFromLicensing({ organizationId: "org-1" });

    expect(await service.findForOrganization("org-1")).toEqual([]);
  });

  /** @scenario "Gateway leaves the hosted provider slot unset when licensing serves no upstream" */
  it("throws to be retried and writes nothing when licensing refuses the read", async () => {
    const { service, repository } = harness(async () => {
      throw new Error("licensing unavailable");
    });

    await expect(service.setFromLicensing({ organizationId: "org-1" })).rejects.toThrow(
      "licensing unavailable",
    );
    expect(await repository.findForOrganization("org-1")).toEqual([]);
  });

  it("is gone once licensing clears it, and clearing twice is harmless", async () => {
    const { service } = harness();
    await service.setFromLicensing({ organizationId: "org-1" });

    await service.clear({ organizationId: "org-1" });
    await service.clear({ organizationId: "org-1" });

    expect(await service.findForOrganization("org-1")).toEqual([]);
  });

  it("belongs to one organization only", async () => {
    const { service } = harness();
    await service.setFromLicensing({ organizationId: "org-1" });

    expect(await service.findForOrganization("org-2")).toEqual([]);
  });

  it("carries the license token, the instance id and the gateway endpoint, after the rest", () => {
    expect(GatewayConnectUpstreamService.providerSlot(upstream, 2)).toEqual({
      id: CONNECT_LANGWATCH_PROVIDER_ID,
      slot: "fallback_2",
      type: "langwatch",
      credentials: { api_key: upstream.token, instance_id: "instance-1" },
      base_url: "https://gateway.langwatch.ai/v1",
      models: [],
      config: {},
    });
  });
});
