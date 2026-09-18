/**
 * The Prisma schema parser turns a schema's text into the model/field facts the
 * Postgres catalog is derived from. This fixes its behaviour on a small inline
 * schema so every parsing rule the derivation relies on has a case that fails
 * loudly when it regresses — docs, `@map`/`@@map`, composite keys, optional and
 * list modifiers, `@db.Decimal`, both directions of relation detection,
 * `@ignore`/`@@ignore`, `Unsupported`, trailing `//` comments, and enum values.
 *
 * @see ../prismaSchema.ts — the parser under test
 */

import { describe, expect, it } from "vitest";

import { type PrismaModel, parsePrismaSchema } from "../prismaSchema";

const FIXTURE = `
enum Color {
  RED
  GREEN
  BLUE
}

/// A team owns projects.
/// Two doc lines.
model Team {
  id       String    @id
  name     String    @map("team_name") // a trailing comment that is ignored
  color    Color
  projects Project[]

  @@map("teams")
}

// a plain comment that breaks doc attachment
model Project {
  id        String   @id
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id])
  price     Decimal  @db.Decimal(10, 2)
  tags      String[]
  note      String?
  blob      Unsupported("bytea")
  secretKey String   @ignore
  /// The owning colour choice.
  color     Color?
}

model Membership {
  teamId String
  userId String

  @@id([teamId, userId])
}

model Hidden {
  id String @id

  @@ignore
}
`;

describe("given an inline Prisma schema", () => {
  const manifest = parsePrismaSchema(FIXTURE);
  const modelByName = new Map<string, PrismaModel>(
    manifest.models.map((model) => [model.name, model]),
  );
  const team = modelByName.get("Team");
  const project = modelByName.get("Project");
  const field = (model: PrismaModel | undefined, name: string) =>
    model?.fields.find((entry) => entry.name === name);

  describe("when a model carries doc lines and @@map", () => {
    it("attaches the /// lines directly above the model", () => {
      expect(team?.documentation).toBe("A team owns projects.\nTwo doc lines.");
    });

    it("reads the physical table from @@map", () => {
      expect(team?.tableName).toBe("teams");
    });

    it("defaults the table name to the model name", () => {
      expect(project?.tableName).toBe("Project");
    });
  });

  describe("when a field carries @map and a trailing // comment", () => {
    it("reads the mapped column and ignores the comment", () => {
      expect(field(team, "name")?.columnName).toBe("team_name");
    });

    it("defaults the column name to the field name", () => {
      expect(field(team, "id")?.columnName).toBe("id");
    });
  });

  describe("when resolving field kinds", () => {
    it("marks a field typed as a model a relation (no @relation needed)", () => {
      expect(field(team, "projects")?.kind).toBe("relation");
    });

    it("marks a field carrying @relation a relation", () => {
      expect(field(project, "team")?.kind).toBe("relation");
    });

    it("keeps the FK scalar beside a relation a scalar", () => {
      expect(field(project, "teamId")?.kind).toBe("scalar");
    });

    it("records the foreign key mapping on the FK-holding relation", () => {
      expect(field(project, "team")?.relation).toEqual({
        fields: ["teamId"],
        references: ["id"],
        to: "Team",
      });
    });

    it("records an empty mapping on the back-reference relation", () => {
      expect(field(team, "projects")?.relation).toEqual({
        fields: [],
        references: [],
        to: "Project",
      });
    });

    it("leaves a scalar field with no relation mapping", () => {
      expect(field(project, "teamId")?.relation).toBeUndefined();
    });

    it("marks an enum-typed field an enum", () => {
      expect(field(team, "color")?.kind).toBe("enum");
    });

    it("marks an Unsupported field unsupported and keeps its raw type", () => {
      const blob = field(project, "blob");
      expect(blob?.kind).toBe("unsupported");
      expect(blob?.type).toBe('Unsupported("bytea")');
    });
  });

  describe("when a field carries modifiers", () => {
    it("records a list", () => {
      expect(field(project, "tags")?.isList).toBe(true);
    });

    it("records optional", () => {
      const note = field(project, "note");
      expect(note?.isOptional).toBe(true);
      expect(note?.isList).toBe(false);
    });

    it("records @db.Decimal precision and scale", () => {
      expect(field(project, "price")?.decimal).toEqual({
        precision: 10,
        scale: 2,
      });
    });

    it("attaches /// docs to the field directly below them", () => {
      expect(field(project, "color")?.documentation).toBe(
        "The owning colour choice.",
      );
    });
  });

  describe("when a primary key is composite", () => {
    it("reads @@id as the field-name list", () => {
      expect(modelByName.get("Membership")?.primaryKey).toEqual([
        "teamId",
        "userId",
      ]);
    });

    it("reads a field @id as a single-element key", () => {
      expect(project?.primaryKey).toEqual(["id"]);
    });
  });

  describe("when a field or model opts out", () => {
    it("drops an @ignore field", () => {
      expect(field(project, "secretKey")).toBeUndefined();
    });

    it("drops an @@ignore model", () => {
      expect(modelByName.has("Hidden")).toBe(false);
    });
  });

  describe("when reading enums", () => {
    it("lists every value", () => {
      expect(manifest.enums).toEqual([
        { name: "Color", values: ["RED", "GREEN", "BLUE"] },
      ]);
    });
  });
});
