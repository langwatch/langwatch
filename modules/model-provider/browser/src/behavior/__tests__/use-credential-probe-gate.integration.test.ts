/**
 * @vitest-environment jsdom
 * Spec: specs/model-providers/credential-validation.feature
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCredentialProbeGate } from "../use-credential-probe-gate.ts";

const customKeys = { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://gw.elb.amazonaws.com/v1" };

describe("useCredentialProbeGate", () => {
  it("offers Save anyway after a refusal the save can pass", () => {
    const { result } = renderHook(() =>
      useCredentialProbeGate({ customKeys, refusalCode: "provider_unreachable" }),
    );

    act(() => result.current.recordRefusal());

    expect(result.current.saveLabel).toBe("Save anyway");
    expect(result.current.probeRequired).toBe(false);
  });

  /** @scenario "A base URL refused by the outbound policy offers no Save anyway" */
  it("keeps Save after the outbound policy refused the base URL", () => {
    const { result } = renderHook(() =>
      useCredentialProbeGate({ customKeys, refusalCode: "provider_endpoint_refused" }),
    );

    act(() => result.current.recordRefusal());

    expect(result.current.saveLabel).toBe("Save");
    expect(result.current.probeRequired).toBe(true);
  });
});
