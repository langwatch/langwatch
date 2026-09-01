/**
 * Which projects a dataset may be replicated into.
 *
 * The rules the platform dialog reached `~/server/api/rbac` for, rebuilt over
 * `@langwatch/authz-contract`. What is pinned here is the FALLTHROUGH ORDER a
 * membership row is read in — a custom role's own list, then the built-in team
 * role — and the two shapes that decide whether a project is offered at all.
 */

import { describe, expect, it } from "vitest";
import {
  DATASET_COPY_PERMISSION,
  datasetCopyTargets,
  type DatasetCopyOrganization,
} from "../src/features/dataset/model/dataset-copy-targets";

const USER = "user_1";

const organization = (teams: DatasetCopyOrganization["teams"]): DatasetCopyOrganization => ({
  name: "Acme",
  teams,
});

const project = (id: string, name: string) => ({ id, name });

describe("datasetCopyTargets", () => {
  describe("given the reader is not signed in", () => {
    it("offers nothing", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "ADMIN" }],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: undefined,
        }),
      ).toEqual([]);
    });
  });

  describe("given a team the reader holds no membership row in", () => {
    it("offers none of its projects", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([{ name: "Other", members: [], projects: [project("p1", "One")] }]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });

  describe("given a built-in team role", () => {
    it("offers the projects of a team the role may create datasets in", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "ADMIN" }],
                projects: [project("p1", "One"), project("p2", "Two")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([
        { label: "Acme / Core / One", value: "p1" },
        { label: "Acme / Core / Two", value: "p2" },
      ]);
    });

    /** @scenario "Replication targets are the teams the reader may create datasets in" */
    it("leaves out the projects of a team the role may only read", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "VIEWER" }],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });

    it("reads an unrecognised legacy role as the most restrictive one", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "SOMETHING_OLD" }],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });

  describe("given a custom role", () => {
    it("reads its own permission list rather than the built-in role", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [
                  {
                    userId: USER,
                    // The built-in role would refuse; the assigned list grants.
                    role: "VIEWER",
                    assignedRole: { permissions: [DATASET_COPY_PERMISSION] },
                  },
                ],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([{ label: "Acme / Core / One", value: "p1" }]);
    });

    /**
     * The column is JSON, so an unedited row arrives as `null` and a legacy row
     * can arrive as anything. An EMPTY list is what the platform hook treated as
     * "no custom answer", falling through to the built-in role.
     */
    it("falls through to the built-in role when its list is empty", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "ADMIN", assignedRole: { permissions: [] } }],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([{ label: "Acme / Core / One", value: "p1" }]);
    });

    it("falls through to the built-in role when its list is not an array", () => {
      expect(
        datasetCopyTargets({
          organizations: [
            organization([
              {
                name: "Core",
                members: [{ userId: USER, role: "VIEWER", assignedRole: { permissions: "all" } }],
                projects: [project("p1", "One")],
              },
            ]),
          ],
          userId: USER,
        }),
      ).toEqual([]);
    });
  });
});
