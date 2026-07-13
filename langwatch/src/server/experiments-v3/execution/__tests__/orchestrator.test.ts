import { describe, expect, it } from "vitest";
import type { EvaluationsV3State } from "~/experiments-v3/types";
import { generateCells, generateComparisonCells } from "../orchestrator";
import type { ExecutionScope } from "../types";

describe("orchestrator", () => {
  // Helper to create test state (partial state with just what generateCells needs)
  const createTestState = (
    targetCount = 2,
    evaluatorCount = 1,
  ): Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  > => ({
    datasets: [
      {
        id: "dataset-1",
        name: "Test Dataset",
      } as EvaluationsV3State["datasets"][0],
    ],
    activeDatasetId: "dataset-1",
    targets: Array.from({ length: targetCount }, (_, i) => ({
      id: `target-${i + 1}`,
      type: "prompt" as const,
      name: `Target ${i + 1}`,
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
      mappings: {
        "dataset-1": {
          input: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "question",
          },
        },
      },
      localPromptConfig: {
        llm: { model: "openai/gpt-4o-mini", temperature: 0 },
        messages: [{ role: "user" as const, content: "{{input}}" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      },
    })) as EvaluationsV3State["targets"],
    evaluators: Array.from({ length: evaluatorCount }, (_, i) => ({
      id: `eval-${i + 1}`,
      evaluatorType: "langevals/exact_match" as const,
      name: `Evaluator ${i + 1}`,
      settings: {},
      inputs: [
        { identifier: "output", type: "str" as const },
        { identifier: "expected_output", type: "str" as const },
      ],
      mappings: {
        "dataset-1": {
          "target-1": {
            output: {
              type: "source",
              source: "target",
              sourceId: "target-1",
              sourceField: "output",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
          "target-2": {
            output: {
              type: "source",
              source: "target",
              sourceId: "target-2",
              sourceField: "output",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      },
    })) as EvaluationsV3State["evaluators"],
  });

  const createTestDataset = (rowCount = 3) =>
    Array.from({ length: rowCount }, (_, i) => ({
      question: `Question ${i}`,
      expected: `Answer ${i}`,
    }));

  describe("generateCells", () => {
    it("generates all cells for full execution scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(6); // 3 rows × 2 targets

      // Check each cell has correct structure
      for (const cell of cells) {
        expect(cell.rowIndex).toBeGreaterThanOrEqual(0);
        expect(cell.rowIndex).toBeLessThan(3);
        expect(cell.targetId).toMatch(/^target-[12]$/);
        expect(cell.targetConfig).toBeDefined();
        expect(cell.evaluatorConfigs).toHaveLength(1);
        expect(cell.datasetEntry).toBeDefined();
      }
    });

    it("generates cells for rows scope (single row)", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "rows", rowIndices: [1] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(2); // 1 row × 2 targets
      expect(cells.every((c) => c.rowIndex === 1)).toBe(true);
    });

    it("generates cells for rows scope (multiple rows)", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(5);
      const scope: ExecutionScope = { type: "rows", rowIndices: [0, 2, 4] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(6); // 3 rows × 2 targets
      const rowIndices = new Set(cells.map((c) => c.rowIndex));
      expect(rowIndices).toEqual(new Set([0, 2, 4]));
    });

    it("generates cells for single target scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = { type: "target", targetId: "target-1" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(3); // 3 rows × 1 target
      expect(cells.every((c) => c.targetId === "target-1")).toBe(true);
    });

    it("generates single cell for cell scope", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = {
        type: "cell",
        rowIndex: 2,
        targetId: "target-2",
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(1);
      expect(cells[0]?.rowIndex).toBe(2);
      expect(cells[0]?.targetId).toBe("target-2");
    });

    it("returns empty array for non-existent target", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = {
        type: "target",
        targetId: "non-existent",
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });

    it("filters out-of-bounds row indices", () => {
      const state = createTestState(2, 1);
      const datasetRows = createTestDataset(3); // 0, 1, 2
      const scope: ExecutionScope = { type: "rows", rowIndices: [1, 10, 20] };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(2); // Only row 1 × 2 targets
      expect(cells.every((c) => c.rowIndex === 1)).toBe(true);
    });

    it("attaches dataset entry with _datasetId", () => {
      const state = createTestState(1, 0);
      const datasetRows = [{ question: "Hello", expected: "World" }];
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells[0]?.datasetEntry).toEqual({
        _datasetId: "dataset-1",
        question: "Hello",
        expected: "World",
      });
    });

    it("attaches all evaluators to each cell", () => {
      const state = createTestState(1, 3); // 1 target, 3 evaluators
      const datasetRows = [{ question: "Test", expected: "Test" }];
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells[0]?.evaluatorConfigs).toHaveLength(3);
    });

    it("defers pairwise evaluators to phase 2 instead of attaching them to target cells", () => {
      const state = createTestState(2, 1);
      state.evaluators.push({
        id: "pairwise-eval",
        evaluatorType: "langevals/pairwise_compare",
        inputs: [
          { identifier: "candidate_a_output", type: "str" },
          { identifier: "candidate_b_output", type: "str" },
          { identifier: "golden", type: "str" },
        ],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const datasetRows = createTestDataset(1);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(2);
      expect(
        cells.every((cell) =>
          cell.evaluatorConfigs.every((evaluator) => !evaluator.pairwise),
        ),
      ).toBe(true);
    });

    it("skips column-style pairwise evaluator targets during phase 1", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [
          { identifier: "candidate_a_output", type: "str" },
          { identifier: "candidate_b_output", type: "str" },
          { identifier: "golden", type: "str" },
        ],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const datasetRows = createTestDataset(1);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells.map((cell) => cell.targetId)).toEqual([
        "target-1",
        "target-2",
      ]);
    });

    it("skips column-style n-way evaluator targets during phase 1", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "select-best-target",
        type: "evaluator",
        targetEvaluatorId: "db-select-best-evaluator",
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "golden", type: "str" },
        ],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        comparison: {
          variants: ["target-1", "target-2"],
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
          randomizeOrder: true,
        },
      });
      const datasetRows = createTestDataset(1);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells.map((cell) => cell.targetId)).toEqual([
        "target-1",
        "target-2",
      ]);
    });

    describe("when an n-way evaluator is attached as a chip evaluator", () => {
      // Regression (#5101): phase 1 excluded `e.pairwise` but not
      // `e.selectBest`, so the n-way evaluator was attached to every
      // per-target cell. Those cells have no `cell.selectBest`, so
      // buildEvaluatorInputs fell through to the generic mapping branch,
      // produced an empty input object, and nlpgo rejected the request
      // with "evaluatorblock: Data required".
      it("does not attach it to per-target phase 1 cells", () => {
        const state = createTestState(2, 0);
        state.evaluators.push({
          id: "eval-select-best",
          evaluatorType: "langevals/select_best_compare",
          inputs: [],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2"],
            hasGoldenAnswer: true,
            goldenField: "expected",
            includeMetrics: [],
            randomizeOrder: true,
          },
        } as EvaluationsV3State["evaluators"][0]);
        const datasetRows = createTestDataset(1);
        const scope: ExecutionScope = { type: "full" };

        const cells = generateCells(state, datasetRows, scope);

        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) {
          expect(cell.evaluatorConfigs.map((e) => e.id)).not.toContain(
            "eval-select-best",
          );
        }
      });
    });
  });

  describe("generateComparisonCells", () => {
    it("creates a column-target pairwise cell with both candidate outputs", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [
          { identifier: "candidate_a_output", type: "str" },
          { identifier: "candidate_b_output", type: "str" },
          { identifier: "golden", type: "str" },
        ],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const completedTargetOutputs = new Map([
        [
          "0:target-1",
          { output: { output: "answer from A" }, cost: 0.01, duration: 120 },
        ],
        [
          "0:target-2",
          { output: { output: "answer from B" }, cost: 0.02, duration: 150 },
        ],
      ]);

      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        completedTargetOutputs,
      );

      expect(cells).toHaveLength(1);
      expect(cells[0]?.targetId).toBe("pairwise-target");
      expect(cells[0]?.skipTarget).toBe(true);
      // Serialized, not the raw dict: langevals types CandidateInput.output
      // as `str` and pydantic refuses to coerce an object, so passing the
      // dict through 422s the whole evaluation.
      expect(cells[0]?.comparison?.candidates[0]?.output).toBe(
        '{"output":"answer from A"}',
      );
      expect(cells[0]?.comparison?.candidates[1]?.output).toBe(
        '{"output":"answer from B"}',
      );
      expect(cells[0]?.evaluatorConfigs[0]?.comparison?.goldenField).toBe(
        "expected",
      );
    });

    // #5101 is specifically about N-way (3+) comparisons, not just the
    // 2-slot pairwise case every other test in this suite exercises —
    // every candidate must reach the judge, not just the first two.
    describe("given three or more variants", () => {
      it("includes every variant's output as a candidate", () => {
        const state = createTestState(3, 0);
        state.targets.push({
          id: "comparison-target",
          type: "evaluator",
          targetEvaluatorId: "db-select-best-evaluator",
          inputs: [],
          outputs: [{ identifier: "label", type: "str" }],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2", "target-3"],
            hasGoldenAnswer: true,
            goldenField: "expected",
            includeMetrics: [],
            randomizeOrder: true,
          },
        });

        const completedTargetOutputs = new Map([
          [
            "0:target-1",
            { output: { output: "answer from 1" }, cost: 0.01, duration: 100 },
          ],
          [
            "0:target-2",
            { output: { output: "answer from 2" }, cost: 0.02, duration: 110 },
          ],
          [
            "0:target-3",
            { output: { output: "answer from 3" }, cost: 0.03, duration: 120 },
          ],
        ]);

        const { cells } = generateComparisonCells(
          state,
          createTestDataset(1),
          completedTargetOutputs,
        );

        expect(cells).toHaveLength(1);
        expect(cells[0]?.comparison?.candidates).toHaveLength(3);
        expect(cells[0]?.comparison?.candidates.map((c) => c.id)).toEqual([
          "target-1",
          "target-2",
          "target-3",
        ]);
        expect(cells[0]?.comparison?.candidates[2]?.output).toBe(
          '{"output":"answer from 3"}',
        );
      });
    });

    // langevals types CandidateInput.output as `str`. Pydantic will not coerce
    // a dict / list / number, so anything non-string reaching the judge 422s
    // the run. A target emitting a structured output must therefore be either
    // narrowed to a field by variantOutputPaths, or serialized.
    describe("given a variant whose output is structured", () => {
      const structuredState = (
        variantOutputPaths?: Record<string, string[]>,
      ) => {
        const state = createTestState(2, 0);
        state.targets.push({
          id: "comparison-target",
          type: "evaluator",
          targetEvaluatorId: "db-select-best-evaluator",
          inputs: [],
          outputs: [{ identifier: "label", type: "str" }],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2"],
            hasGoldenAnswer: true,
            goldenField: "expected",
            includeMetrics: [],
            randomizeOrder: true,
            ...(variantOutputPaths && { variantOutputPaths }),
          },
        });
        return state;
      };

      const structuredOutputs = new Map([
        [
          "0:target-1",
          { output: { answer: "from A", confidence: 0.9 }, cost: 0, duration: 1 },
        ],
        [
          "0:target-2",
          { output: { answer: "from B", confidence: 0.4 }, cost: 0, duration: 1 },
        ],
      ]);

      describe("when an output path narrows it to a field", () => {
        it("sends that field's value as the candidate text", () => {
          const { cells } = generateComparisonCells(
            structuredState({
              "target-1": ["answer"],
              "target-2": ["answer"],
            }),
            createTestDataset(1),
            structuredOutputs,
          );

          expect(cells[0]?.comparison?.candidates[0]?.output).toBe("from A");
          expect(cells[0]?.comparison?.candidates[1]?.output).toBe("from B");
        });
      });

      describe("when no output path was picked", () => {
        it("serializes the whole object rather than failing the run", () => {
          const { cells } = generateComparisonCells(
            structuredState(),
            createTestDataset(1),
            structuredOutputs,
          );

          const [first, second] = cells[0]?.comparison?.candidates ?? [];
          expect(typeof first?.output).toBe("string");
          expect(typeof second?.output).toBe("string");
          expect(JSON.parse(first!.output as string)).toEqual({
            answer: "from A",
            confidence: 0.9,
          });
        });
      });

      // A null output still counts as "the target ran", so it passes the
      // missing-output check. But null has no text to compare, and judging the
      // four characters "null" against real answers is worse than skipping. The
      // row is skipped with an empty-output reason rather than judged.
      describe("when the output is null", () => {
        it("skips the row instead of judging the text 'null'", () => {
          const { cells, skipReasons } = generateComparisonCells(
            structuredState(),
            createTestDataset(1),
            new Map([
              ["0:target-1", { output: null, cost: 0, duration: 1 }],
              ["0:target-2", { output: { answer: "B" }, cost: 0, duration: 1 }],
            ]) as never,
          );

          expect(cells).toHaveLength(0);
          expect(skipReasons[0]?.kind).toBe("empty-output");
          expect(skipReasons[0]?.variantNames).toEqual(["target-1"]);
        });
      });
    });

    // A variant column can carry its own grading evaluators. Those scores are
    // appended to the candidate's text so the judge can weigh them, rather than
    // re-deriving quality it has already been told.
    describe("given a variant column has its own evaluator scores", () => {
      const scoredState = () => {
        const state = createTestState(2, 0);
        state.targets.push({
          id: "comparison-target",
          type: "evaluator",
          targetEvaluatorId: "db-select-best-evaluator",
          inputs: [],
          outputs: [{ identifier: "label", type: "str" }],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2"],
            hasGoldenAnswer: true,
            goldenField: "expected",
            includeMetrics: [],
            randomizeOrder: true,
          },
        });
        return state;
      };

      const plainOutputs = new Map([
        ["0:target-1", { output: "answer from A", cost: 0, duration: 1 }],
        ["0:target-2", { output: "answer from B", cost: 0, duration: 1 }],
      ]);

      it("appends each score to that candidate's output", () => {
        const { cells } = generateComparisonCells(
          scoredState(),
          createTestDataset(1),
          plainOutputs,
          new Map([
            [
              "0:target-1",
              [
                { name: "Faithfulness", score: 0.91 },
                { name: "Toxicity", passed: true },
              ],
            ],
          ]),
        );

        const output = cells[0]?.comparison?.candidates[0]?.output as string;
        expect(output).toContain("answer from A");
        expect(output).toContain("--- Existing evaluator scores ---");
        expect(output).toContain("- Faithfulness: score=0.91");
        expect(output).toContain("- Toxicity: passed=true");
      });

      it("leaves a candidate with no scores untouched", () => {
        const { cells } = generateComparisonCells(
          scoredState(),
          createTestDataset(1),
          plainOutputs,
          new Map([["0:target-1", [{ name: "Faithfulness", score: 0.91 }]]]),
        );

        expect(cells[0]?.comparison?.candidates[1]?.output).toBe(
          "answer from B",
        );
      });

      // The scores map is optional — nothing appends when it is absent.
      it("judges the bare outputs when no scores were collected", () => {
        const { cells } = generateComparisonCells(
          scoredState(),
          createTestDataset(1),
          plainOutputs,
        );

        expect(cells[0]?.comparison?.candidates[0]?.output).toBe(
          "answer from A",
        );
      });

      // The output is narrowed to its field BEFORE the scores are appended, so
      // the judge reads the answer and its scores, not the whole blob.
      describe("when the variant's output is structured", () => {
        const structuredState = () => {
          const state = scoredState();
          const comparisonTarget = state.targets.at(-1)!;
          comparisonTarget.comparison!.variantOutputPaths = {
            "target-1": ["answer"],
          };
          return state;
        };

        const structured = new Map([
          [
            "0:target-1",
            {
              output: { answer: "from A", confidence: 0.9 },
              cost: 0,
              duration: 1,
            },
          ],
          ["0:target-2", { output: "answer from B", cost: 0, duration: 1 }],
        ]);

        const scores = new Map([
          ["0:target-1", [{ name: "Faithfulness", score: 0.91 }]],
        ]);

        it("appends the scores to the picked field, not the whole object", () => {
          const { cells } = generateComparisonCells(
            structuredState(),
            createTestDataset(1),
            structured,
            scores,
          );

          expect(cells[0]?.comparison?.candidates[0]?.output).toBe(
            "from A\n\n--- Existing evaluator scores ---\n- Faithfulness: score=0.91",
          );
        });

        it("appends the scores to the serialized object when no field is picked", () => {
          const { cells } = generateComparisonCells(
            scoredState(),
            createTestDataset(1),
            structured,
            scores,
          );

          const output = cells[0]?.comparison?.candidates[0]?.output as string;
          expect(output).toContain('{"answer":"from A","confidence":0.9}');
          expect(output).toContain("- Faithfulness: score=0.91");
        });

        // A variant that produced no output must not have its score block
        // appended — that would leave a candidate that was scores and nothing
        // else, which langevals won't drop, so the judge would score a variant
        // that had said nothing. The row is skipped with an empty-output reason
        // instead.
        it("skips the row rather than sending a scores-only candidate", () => {
          const { cells, skipReasons } = generateComparisonCells(
            scoredState(),
            createTestDataset(1),
            new Map([
              ["0:target-1", { output: "", cost: 0, duration: 1 }],
              ["0:target-2", { output: "answer from B", cost: 0, duration: 1 }],
            ]),
            scores,
          );

          expect(cells).toHaveLength(0);
          expect(skipReasons[0]?.kind).toBe("empty-output");
          expect(skipReasons[0]?.variantNames).toEqual(["target-1"]);
        });

        // An unserializable output (circular refs, BigInt) has no text to
        // carry, so the row is skipped for the same reason.
        it("skips the row when an output cannot be serialized", () => {
          const circular: Record<string, unknown> = { answer: "from A" };
          circular.self = circular;

          const { cells, skipReasons } = generateComparisonCells(
            scoredState(),
            createTestDataset(1),
            new Map([
              ["0:target-1", { output: circular, cost: 0, duration: 1 }],
              ["0:target-2", { output: "answer from B", cost: 0, duration: 1 }],
            ]),
            scores,
          );

          expect(cells).toHaveLength(0);
          expect(skipReasons[0]?.kind).toBe("empty-output");
        });
      });
    });

    it("uses the prompt handle as candidate id when loadedPrompts has it", () => {
      const state = createTestState(2, 0);
      // Mark the variants as prompt-typed so variantIdentifierFor can look
      // them up. The IDs in createTestState are "target-1" and "target-2".
      const variantA = state.targets[0]!;
      const variantB = state.targets[1]!;
      (variantA as { type: string; promptId?: string }).type = "prompt";
      (variantA as { type: string; promptId?: string }).promptId = "prompt_A";
      (variantB as { type: string; promptId?: string }).type = "prompt";
      (variantB as { type: string; promptId?: string }).promptId = "prompt_B";
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [],
        mappings: {},
        pairwise: {
          variantA: variantA.id,
          variantB: variantB.id,
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const loadedPrompts = new Map<
        string,
        { handle: string } & Record<string, unknown>
      >([
        ["prompt_A", { handle: "say-hi" } as never],
        ["prompt_B", { handle: "be-formal" } as never],
      ]);
      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        new Map([
          ["0:" + variantA.id, { output: "a" }],
          ["0:" + variantB.id, { output: "b" }],
        ]),
        undefined,
        loadedPrompts as never,
      );
      expect(cells).toHaveLength(1);
      expect(cells[0]?.comparison?.candidates[0]?.id).toBe("say-hi");
      expect(cells[0]?.comparison?.candidates[1]?.id).toBe("be-formal");
    });

    // Two variants pointing at the SAME prompt (compare v1 vs v2, the case
    // comparison.feature adds "same-name variants" for) resolve to the same
    // handle. Using the handle as candidate id would make the winning label
    // name two candidates at once, so the winner is unattributable. The
    // colliding entries must fall back to their unique target ids instead.
    it("falls back to target ids when two variants share the same prompt handle", () => {
      const state = createTestState(2, 0);
      const variantA = state.targets[0]!;
      const variantB = state.targets[1]!;
      // Both point at the SAME prompt → same handle.
      (variantA as { type: string; promptId?: string }).type = "prompt";
      (variantA as { type: string; promptId?: string }).promptId = "prompt_X";
      (variantB as { type: string; promptId?: string }).type = "prompt";
      (variantB as { type: string; promptId?: string }).promptId = "prompt_X";
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [],
        mappings: {},
        pairwise: {
          variantA: variantA.id,
          variantB: variantB.id,
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const loadedPrompts = new Map<
        string,
        { handle: string } & Record<string, unknown>
      >([["prompt_X", { handle: "shared-handle" } as never]]);

      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        new Map([
          ["0:" + variantA.id, { output: "a" }],
          ["0:" + variantB.id, { output: "b" }],
        ]),
        undefined,
        loadedPrompts as never,
      );

      const ids = cells[0]?.comparison?.candidates.map((c) => c.id) ?? [];
      // Distinct — the winner is attributable to exactly one variant.
      expect(new Set(ids).size).toBe(2);
      expect(ids).toEqual([variantA.id, variantB.id]);
    });

    it("falls back to target id (not promptId) when handle is unavailable", () => {
      const state = createTestState(2, 0);
      // Prompt-typed variants with promptIds but NO entry in loadedPrompts —
      // simulates a deleted prompt or a worker that hasn't loaded the cache.
      const variantA = state.targets[0]!;
      const variantB = state.targets[1]!;
      (variantA as { type: string; promptId?: string }).type = "prompt";
      (variantA as { type: string; promptId?: string }).promptId = "prompt_A";
      (variantB as { type: string; promptId?: string }).type = "prompt";
      (variantB as { type: string; promptId?: string }).promptId = "prompt_B";
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [],
        mappings: {},
        pairwise: {
          variantA: variantA.id,
          variantB: variantB.id,
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        new Map([
          ["0:" + variantA.id, { output: "a" }],
          ["0:" + variantB.id, { output: "b" }],
        ]),
        undefined,
        new Map(),
      );
      // Must be the internal target id (which the aggregator can normalize),
      // never the raw promptId KSUID which would silently drop the verdict.
      expect(cells[0]?.comparison?.candidates[0]?.id).toBe(variantA.id);
      expect(cells[0]?.comparison?.candidates[1]?.id).toBe(variantB.id);
      expect(cells[0]?.comparison?.candidates[0]?.id).not.toBe("prompt_A");
    });

    it("does not create comparison cells until every variant has output", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: true,
          goldenField: "expected",
          includeMetrics: [],
        },
      });

      const { cells, skipReasons } = generateComparisonCells(
        state,
        createTestDataset(1),
        new Map([["0:target-1", { output: { output: "answer from A" } }]]),
      );

      expect(cells).toHaveLength(0);
      expect(skipReasons).toHaveLength(1);
      expect(skipReasons[0]?.kind).toBe("missing-output");
      expect(skipReasons[0]?.variantNames).toEqual(["target-2"]);
    });

    // A saved comparison can point at an output field the target no longer
    // emits — someone renamed it on the prompt. The target still runs, so the
    // missing-output check passes it, but the picked field resolves to nothing.
    // The row is skipped with a distinct reason, not judged one candidate short.
    describe("when a picked output field no longer exists", () => {
      const stateWithPath = (path: string[]) => {
        const state = createTestState(2, 0);
        state.targets.push({
          id: "comparison-target",
          type: "evaluator",
          targetEvaluatorId: "db-select-best-evaluator",
          inputs: [],
          outputs: [{ identifier: "label", type: "str" }],
          mappings: {},
          comparison: {
            variants: ["target-1", "target-2"],
            hasGoldenAnswer: true,
            goldenField: "expected",
            includeMetrics: [],
            randomizeOrder: true,
            variantOutputPaths: { "target-1": path },
          },
        });
        return state;
      };

      const structuredOutputs = new Map([
        ["0:target-1", { output: { answer: "from A" }, cost: 0, duration: 1 }],
        ["0:target-2", { output: "answer from B", cost: 0, duration: 1 }],
      ]);

      it("skips the row with an empty-output reason naming the variant", () => {
        const { cells, skipReasons } = generateComparisonCells(
          stateWithPath(["renamed"]),
          createTestDataset(1),
          structuredOutputs,
        );

        expect(cells).toHaveLength(0);
        expect(skipReasons).toHaveLength(1);
        expect(skipReasons[0]?.kind).toBe("empty-output");
        expect(skipReasons[0]?.variantNames).toEqual(["target-1"]);
      });

      it("judges the row when the picked field does exist", () => {
        const { cells, skipReasons } = generateComparisonCells(
          stateWithPath(["answer"]),
          createTestDataset(1),
          structuredOutputs,
        );

        expect(skipReasons).toHaveLength(0);
        expect(cells).toHaveLength(1);
        expect(cells[0]?.comparison?.candidates[0]?.output).toBe("from A");
      });
    });

    // #5378: golden field is only required when the user hasn't opted out
    // of golden-answer comparison. Before this fix, an empty goldenField
    // always skipped cell generation regardless of hasGoldenAnswer, so a
    // no-golden pairwise column never ran at all.
    it("creates a cell with an empty goldenField when hasGoldenAnswer is false", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: false,
          goldenField: "",
          includeMetrics: [],
        },
      });
      const completedTargetOutputs = new Map([
        [
          "0:target-1",
          { output: { output: "answer from A" }, cost: 0.01, duration: 120 },
        ],
        [
          "0:target-2",
          { output: { output: "answer from B" }, cost: 0.02, duration: 150 },
        ],
      ]);

      const { cells, skipReasons } = generateComparisonCells(
        state,
        createTestDataset(1),
        completedTargetOutputs,
      );

      expect(skipReasons).toHaveLength(0);
      expect(cells).toHaveLength(1);
      expect(cells[0]?.targetId).toBe("pairwise-target");
      expect(cells[0]?.evaluatorConfigs[0]?.comparison?.goldenField).toBe("");
    });

    it("still skips when hasGoldenAnswer is true and goldenField is empty", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: true,
          goldenField: "",
          includeMetrics: [],
        },
      });
      const completedTargetOutputs = new Map([
        ["0:target-1", { output: { output: "answer from A" } }],
        ["0:target-2", { output: { output: "answer from B" } }],
      ]);

      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        completedTargetOutputs,
      );

      expect(cells).toHaveLength(0);
    });

    // Regression: resolveVariants (shared by both comparison carriers) used
    // to only check variant count. The column-target loop (above) additionally
    // guarded with isGoldenFieldSatisfied before calling it, but the
    // chip-style loop (evaluator.comparison) did not — a chip comparison
    // with hasGoldenAnswer:true and no goldenField ran anyway, feeding the
    // judge an empty `golden` while its own settings claimed golden-aware.
    it("also skips a chip-style comparison when hasGoldenAnswer is true and goldenField is empty", () => {
      const state = createTestState(2, 0);
      state.evaluators.push({
        id: "eval-chip-comparison",
        evaluatorType: "langevals/select_best_compare",
        inputs: [],
        mappings: {},
        comparison: {
          variants: ["target-1", "target-2"],
          hasGoldenAnswer: true,
          goldenField: "",
          includeMetrics: [],
          randomizeOrder: true,
        },
      } as EvaluationsV3State["evaluators"][0]);
      const completedTargetOutputs = new Map([
        ["0:target-1", { output: { output: "answer from A" } }],
        ["0:target-2", { output: { output: "answer from B" } }],
      ]);

      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        completedTargetOutputs,
      );

      expect(cells).toHaveLength(0);
    });

    // Regression: a legacy pairwise config folded in by fromPairwise copies
    // goldenField verbatim, so hasGoldenAnswer:false can coexist with a
    // stale non-empty goldenField. buildEvaluatorInputs (the runtime path)
    // already gates on `hasGoldenAnswer !== false && goldenField`; the
    // column-target synthetic's static value-mapping must agree, or the
    // judge gets a golden reference the runtime path deliberately omitted.
    it("omits golden from the synthetic mapping when hasGoldenAnswer is false, even with a stale goldenField", () => {
      const state = createTestState(2, 0);
      state.targets.push({
        id: "pairwise-target",
        type: "evaluator",
        targetEvaluatorId: "db-pairwise-evaluator",
        inputs: [],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        pairwise: {
          variantA: "target-1",
          variantB: "target-2",
          hasGoldenAnswer: false,
          goldenField: "expected",
          includeMetrics: [],
        },
      });
      const completedTargetOutputs = new Map([
        ["0:target-1", { output: { output: "answer from A" } }],
        ["0:target-2", { output: { output: "answer from B" } }],
      ]);

      const { cells } = generateComparisonCells(
        state,
        createTestDataset(1),
        completedTargetOutputs,
      );

      expect(cells).toHaveLength(1);
      const mappings = cells[0]?.evaluatorConfigs[0]?.mappings as Record<
        string,
        Record<string, Record<string, { value: unknown }>>
      >;
      expect(mappings["dataset-1"]?.["pairwise-target"]?.golden?.value).toBe(
        undefined,
      );
    });
  });

  describe("generateCells with evaluator-all-rows scope", () => {
    /** @scenario "Running evaluator on all rows creates one execution per row with target output" */
    it("creates one cell per row that has a pre-computed target output", () => {
      const state = createTestState(1, 2);
      const datasetRows = createTestDataset(4);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "eval-1",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
          1: { output: "result-1" },
          3: { output: "result-3" },
        },
        traceIds: {
          0: "trace-0",
          1: "trace-1",
          3: "trace-3",
        },
      };

      const cells = generateCells(state, datasetRows, scope);

      // Only rows 0, 1, 3 have outputs - row 2 is skipped
      expect(cells).toHaveLength(3);
      expect(cells.map((c) => c.rowIndex)).toEqual([0, 1, 3]);
    });

    /** @scenario "Running evaluator on all rows creates one execution per row with target output" */
    it("skips target execution for each cell", () => {
      const state = createTestState(1, 1);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "eval-1",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
          1: { output: "result-1" },
        },
        traceIds: {},
      };

      const cells = generateCells(state, datasetRows, scope);

      for (const cell of cells) {
        expect(cell.skipTarget).toBe(true);
      }
    });

    it("includes only the specified evaluator in each cell", () => {
      const state = createTestState(1, 3);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "eval-2",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
          1: { output: "result-1" },
        },
        traceIds: {},
      };

      const cells = generateCells(state, datasetRows, scope);

      for (const cell of cells) {
        expect(cell.evaluatorConfigs).toHaveLength(1);
        expect(cell.evaluatorConfigs[0]?.id).toBe("eval-2");
      }
    });

    it("assigns precomputed target output to each cell", () => {
      const state = createTestState(1, 1);
      const datasetRows = createTestDataset(3);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "eval-1",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
          2: { output: "result-2" },
        },
        traceIds: {
          0: "trace-0",
          2: "trace-2",
        },
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells[0]?.precomputedTargetOutput).toEqual({ output: "result-0" });
      expect(cells[0]?.traceId).toBe("trace-0");
      expect(cells[1]?.precomputedTargetOutput).toEqual({ output: "result-2" });
      expect(cells[1]?.traceId).toBe("trace-2");
    });

    it("returns empty array when evaluator is not found", () => {
      const state = createTestState(1, 1);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "non-existent",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
        },
        traceIds: {},
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });

    it("returns empty array when target is not found", () => {
      const state = createTestState(1, 1);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "non-existent",
        evaluatorId: "eval-1",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
        },
        traceIds: {},
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });

    // A comparison evaluator needs every variant's output, not one target's —
    // attaching it here would silently produce an empty input object (see the
    // matching Phase-1 skip a few tests up) rather than a real comparison run.
    it("skips a comparison evaluator instead of attaching it to a single-target cell", () => {
      const state = createTestState(1, 0);
      state.evaluators.push({
        id: "cmp-eval",
        evaluatorType: "langevals/select_best_compare",
        name: "Comparison",
        settings: {},
        inputs: [],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        comparison: {
          variants: ["target-1"],
          hasGoldenAnswer: false,
          includeMetrics: [],
          randomizeOrder: true,
        },
      } as EvaluationsV3State["evaluators"][number]);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId: "target-1",
        evaluatorId: "cmp-eval",
        precomputedTargetOutputs: {
          0: { output: "result-0" },
          1: { output: "result-1" },
        },
        traceIds: {},
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });
  });

  describe("generateCells with evaluator scope", () => {
    // Same reasoning as the evaluator-all-rows guard above — a comparison
    // evaluator can't run against one target's precomputed output.
    it("skips a comparison evaluator instead of attaching it to a single-target cell", () => {
      const state = createTestState(1, 0);
      state.evaluators.push({
        id: "cmp-eval",
        evaluatorType: "langevals/select_best_compare",
        name: "Comparison",
        settings: {},
        inputs: [],
        outputs: [{ identifier: "label", type: "str" }],
        mappings: {},
        comparison: {
          variants: ["target-1"],
          hasGoldenAnswer: false,
          includeMetrics: [],
          randomizeOrder: true,
        },
      } as EvaluationsV3State["evaluators"][number]);
      const datasetRows = createTestDataset(1);
      const scope: ExecutionScope = {
        type: "evaluator",
        targetId: "target-1",
        rowIndex: 0,
        evaluatorId: "cmp-eval",
        targetOutput: { output: "result-0" },
      };

      const cells = generateCells(state, datasetRows, scope);

      expect(cells).toHaveLength(0);
    });
  });

  describe("cell ordering", () => {
    it("orders cells by row first, then target", () => {
      const state = createTestState(2, 0);
      const datasetRows = createTestDataset(2);
      const scope: ExecutionScope = { type: "full" };

      const cells = generateCells(state, datasetRows, scope);

      // Expected order: (0, t1), (0, t2), (1, t1), (1, t2)
      expect(cells[0]?.rowIndex).toBe(0);
      expect(cells[0]?.targetId).toBe("target-1");
      expect(cells[1]?.rowIndex).toBe(0);
      expect(cells[1]?.targetId).toBe("target-2");
      expect(cells[2]?.rowIndex).toBe(1);
      expect(cells[2]?.targetId).toBe("target-1");
      expect(cells[3]?.rowIndex).toBe(1);
      expect(cells[3]?.targetId).toBe("target-2");
    });
  });
});
