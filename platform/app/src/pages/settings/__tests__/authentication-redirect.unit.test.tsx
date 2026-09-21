/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import AuthenticationSettingsRedirect from "../authentication";

describe("the old Authentication settings address", () => {
  it("lands on Security without rendering a second settings page", () => {
    render(
      <MemoryRouter initialEntries={["/settings/authentication"]}>
        <Routes>
          <Route
            path="/settings/authentication"
            element={<AuthenticationSettingsRedirect />}
          />
          <Route
            path="/settings/security"
            element={<div>Security destination</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Security destination")).toBeInTheDocument();
  });
});
