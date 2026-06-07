/**
 * Real-Chromium QA for the Zod-first evaluator catalog. The settings forms in
 * the app are driven by `evaluatorsSchema.shape[type].shape.settings` and the
 * `AVAILABLE_EVALUATORS` metadata — both now generated as Zod, not via
 * ts-to-zod. This renders the real (unmocked) catalog so we can see the fields,
 * types and defaults the forms build from, and captures a screenshot for the PR.
 */

import {
  Badge,
  Box,
  ChakraProvider,
  defaultSystem,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";
import {
  AVAILABLE_EVALUATORS,
  evaluatorsSchema,
} from "../../../server/evaluations/evaluators.generated";

afterEach(() => cleanup());

const SHOWCASE = [
  "langevals/exact_match",
  "langevals/llm_boolean",
  "presidio/pii_detection",
  "ragas/factual_correctness",
] as const;

function fieldType(schema: z.ZodTypeAny): string {
  const def: any = (schema as any)._def;
  const inner = def?.innerType ? fieldType(def.innerType) : null;
  if (inner) return inner;
  const t = def?.typeName as string | undefined;
  return (
    {
      ZodString: "string",
      ZodNumber: "number",
      ZodBoolean: "boolean",
      ZodObject: "object",
      ZodArray: "array",
      ZodUnion: "enum",
    }[t ?? ""] ?? "value"
  );
}

function Catalog() {
  return (
    <ChakraProvider value={defaultSystem}>
      <Box padding={6} background="gray.50" width="820px">
        <Heading size="md" marginBottom={1}>
          Evaluator catalog (Zod-first)
        </Heading>
        <Text fontSize="sm" color="gray.600" marginBottom={4}>
          {Object.keys(evaluatorsSchema.shape).length} evaluators · schemas and
          defaults inferred from Zod, no ts-to-zod
        </Text>
        <VStack align="stretch" gap={3}>
          {SHOWCASE.map((type) => {
            const def = AVAILABLE_EVALUATORS[type];
            const settings = evaluatorsSchema.shape[type].shape.settings;
            const defaults = settings.parse({});
            const fields = Object.entries(settings.shape);
            return (
              <Box
                key={type}
                background="white"
                borderRadius="md"
                borderWidth="1px"
                borderColor="gray.200"
                padding={4}
              >
                <HStack marginBottom={2}>
                  <Text fontWeight="bold">{def.name}</Text>
                  <Badge colorPalette="blue">{def.category}</Badge>
                  <Text fontSize="xs" color="gray.500">
                    {type}
                  </Text>
                </HStack>
                <VStack align="stretch" gap={1}>
                  {fields.map(([name, fieldSchema]) => (
                    <HStack key={name} fontSize="sm" gap={2}>
                      <Text fontFamily="mono" minWidth="180px">
                        {name}
                      </Text>
                      <Badge variant="outline">
                        {fieldType(fieldSchema as z.ZodTypeAny)}
                      </Badge>
                      <Text color="gray.600">
                        default: {JSON.stringify((defaults as any)[name])}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            );
          })}
        </VStack>
      </Box>
    </ChakraProvider>
  );
}

describe("given the Zod-first evaluator catalog", () => {
  describe("when the catalog and its settings schemas are rendered", () => {
    it("shows each evaluator's settings fields and defaults", async () => {
      await page.viewport(880, 720);
      render(<Catalog />);

      await waitFor(() =>
        expect(screen.getByText(/Evaluator catalog \(Zod-first\)/)).toBeVisible(),
      );
      // Defaults come straight from the Zod schema (.parse({}))
      expect(
        screen.getAllByText(/default: "openai\/gpt-5"/).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("case_sensitive")).toBeVisible();

      await page.screenshot({
        path: "/tmp/pr4651/evaluator-catalog-zod.png",
      });
    });
  });
});
