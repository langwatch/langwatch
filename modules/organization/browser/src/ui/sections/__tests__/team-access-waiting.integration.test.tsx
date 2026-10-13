/**
 * @vitest-environment jsdom
 * A member of an organization who sits on none of its teams has nothing to open yet.
 * Spec: specs/identity/identifier-model.feature
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../../testing.tsx";
import { TeamAccessWaiting } from "../team-access-waiting.tsx";

afterEach(cleanup);

describe("given a signed-in member who has not been added to a team", () => {
  /** @scenario A member without team access sees what they are waiting for */
  it("names their organization and offers checking again, going home or signing out", () => {
    const onCheckAccess = vi.fn();
    const { host } = renderWithOrganizationHost(
      <TeamAccessWaiting organizationName="Acme" onCheckAccess={onCheckAccess} />,
    );

    expect(screen.getByRole("dialog", { name: "Waiting for team access" })).toBeInTheDocument();
    expect(screen.getByText(/signed in to Acme/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");

    fireEvent.click(screen.getByRole("button", { name: "Check access" }));
    expect(onCheckAccess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(host.signedOut).toBe(true);
  });
});
