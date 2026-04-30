import { describe, expect, it } from "vitest";
import { buildDecorationPlan, buildDecorationSlots } from "../filterHighlight";

describe("buildDecorationSlots", () => {
  describe("given an empty string", () => {
    it("returns no slots", () => {
      expect(buildDecorationSlots("")).toEqual([]);
      expect(buildDecorationSlots("   ")).toEqual([]);
    });
  });

  describe("given a single tag", () => {
    it("decorates the whole field:value span as a filter-token", () => {
      const slots = buildDecorationSlots("status:error");
      expect(slots).toEqual([{ from: 0, to: 12, className: "filter-token" }]);
    });
  });

  describe("given a scenario field", () => {
    it("uses the scenario accent class", () => {
      const slots = buildDecorationSlots("scenarioVerdict:success");
      expect(slots).toEqual([
        { from: 0, to: 23, className: "filter-token filter-token-scenario" },
      ]);
    });
  });

  describe("given a NOT-prefixed tag", () => {
    it("decorates NOT as a keyword and the tag as excluded", () => {
      const slots = buildDecorationSlots("NOT status:error");
      expect(slots).toEqual([
        { from: 0, to: 3, className: "filter-keyword filter-keyword-not" },
        { from: 4, to: 16, className: "filter-token filter-token-exclude" },
      ]);
    });
  });

  describe("given a `-` shorthand negation", () => {
    it("decorates `-` as a keyword and the tag as excluded", () => {
      const slots = buildDecorationSlots("-status:error");
      expect(slots).toEqual([
        { from: 0, to: 1, className: "filter-keyword filter-keyword-not" },
        { from: 1, to: 13, className: "filter-token filter-token-exclude" },
      ]);
    });
  });

  describe("given an AND between two tags", () => {
    it("decorates each tag and the AND keyword separately", () => {
      const slots = buildDecorationSlots("status:error AND model:gpt-4o");
      expect(slots).toEqual([
        { from: 0, to: 12, className: "filter-token" },
        { from: 13, to: 16, className: "filter-keyword filter-keyword-and" },
        { from: 17, to: 29, className: "filter-token" },
      ]);
    });
  });

  describe("given an OR between two tags", () => {
    it("decorates each tag and the OR keyword separately", () => {
      const slots = buildDecorationSlots("status:error OR status:warning");
      expect(slots).toEqual([
        { from: 0, to: 12, className: "filter-token" },
        { from: 13, to: 15, className: "filter-keyword filter-keyword-or" },
        { from: 16, to: 30, className: "filter-token" },
      ]);
    });
  });

  describe("given a parenthesized group", () => {
    it("decorates both parens and the inner tags", () => {
      const slots = buildDecorationSlots("(status:error OR status:warning)");
      expect(slots).toContainEqual({
        from: 0,
        to: 1,
        className: "filter-paren",
      });
      expect(slots).toContainEqual({
        from: 31,
        to: 32,
        className: "filter-paren",
      });
    });
  });

  describe("given leading whitespace", () => {
    it("offsets locations to match the original string", () => {
      const slots = buildDecorationSlots("  status:error");
      expect(slots).toEqual([{ from: 2, to: 14, className: "filter-token" }]);
    });
  });

  describe("given an unparseable query", () => {
    it("falls back to the regex highlighter", () => {
      const slots = buildDecorationSlots("status:error AND ");
      expect(slots.some((s) => s.className.includes("filter-token"))).toBe(
        true,
      );
    });
  });

  describe("given a baseOffset", () => {
    it("shifts every decoration by the offset", () => {
      const slots = buildDecorationSlots("status:error", 5);
      expect(slots).toEqual([{ from: 5, to: 17, className: "filter-token" }]);
    });
  });
});

describe("buildDecorationPlan — wildcard + boolean cases", () => {
  describe("given a wildcard value followed by AND and another tag", () => {
    it("emits two tag tokens with the AND keyword between them — never one merged token", () => {
      const text = "model:gpt-* AND status:error";
      const plan = buildDecorationPlan(text);

      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
        { from: 16, to: 28, className: "filter-token" },
      ]);

      // AND keyword is its own decoration, not glued to either tag.
      expect(plan.slots).toContainEqual({
        from: 12,
        to: 15,
        className: "filter-keyword filter-keyword-and",
      });

      // Two tag widgets, one per tag.
      expect(plan.tokens).toEqual([
        { start: 0, end: 11, field: "model", value: "gpt-*" },
        { start: 16, end: 28, field: "status", value: "error" },
      ]);
    });
  });

  describe("given a single wildcard value", () => {
    it("decorates only the field:value span — the `*` is part of the value", () => {
      const plan = buildDecorationPlan("model:gpt-*");
      expect(plan.slots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
      ]);
      expect(plan.tokens).toEqual([
        { start: 0, end: 11, field: "model", value: "gpt-*" },
      ]);
    });
  });

  describe("given an OR between two wildcard tags", () => {
    it("emits two tag tokens and the OR keyword separately", () => {
      const plan = buildDecorationPlan("model:gpt-* OR model:claude-*");
      const tokens = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokens).toHaveLength(2);
      expect(plan.slots).toContainEqual({
        from: 12,
        to: 14,
        className: "filter-keyword filter-keyword-or",
      });
    });
  });

  describe("given an incomplete `<tag> AND` (no right operand)", () => {
    it("falls back to the regex highlighter and only decorates the parseable left tag", () => {
      const plan = buildDecorationPlan("model:gpt-* AND");
      // Liqe parse fails for incomplete AND. The regex fallback only matches
      // the field:value span and leaves the dangling AND unstyled.
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
      ]);
      // No AND keyword decoration — the parser couldn't confirm it as one.
      expect(
        plan.slots.some((s) => s.className.includes("filter-keyword-and")),
      ).toBe(false);
      // No widget tokens emitted by the regex fallback.
      expect(plan.tokens).toEqual([]);
    });
  });

  describe("operator matrix — comparison ops produce a single token", () => {
    it.each([
      ["greater-than", "cost:>5"],
      ["greater-or-equal", "cost:>=5"],
      ["less-than", "duration:<5000"],
      ["less-or-equal", "duration:<=5000"],
    ])("`%s` (%s) is decorated as a single numeric filter-token", (_label, query) => {
      const plan = buildDecorationPlan(query);
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toHaveLength(1);
      // Comparison form sits on a numeric field → green tint.
      expect(tokenSlots[0]?.className).toContain("filter-token-numeric");
      expect(tokenSlots[0]?.from).toBe(0);
      expect(tokenSlots[0]?.to).toBe(query.length);
    });
  });

  describe("operator matrix — range form (KNOWN BUG)", () => {
    it("`cost:[1 TO 10]` decoration is BROKEN — liqe's Tag.location for ranges starts at `[` and has no `end`", () => {
      // KNOWN BUG: liqe gives a Tag-with-RangeExpression a location of
      // `{ start: 5 }` (the `[` offset) with NO `end` field. The
      // highlighter reads `tag.location.end` directly and produces a
      // decoration of `{ from: 5, to: NaN }` — visually nothing renders,
      // OR the chip extends to end-of-doc depending on the browser.
      // Pinned so we notice if liqe ever fixes this OR we add a
      // workaround in walkAst (e.g. `tag.expression.location.end` for
      // RangeExpression). The widget tokens have the same defect.
      const plan = buildDecorationPlan("cost:[1 TO 10]");
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toHaveLength(1);
      expect(tokenSlots[0]?.from).toBe(5);
      expect(Number.isNaN(tokenSlots[0]?.to)).toBe(true);
    });
  });

  describe("operator matrix — quoted values", () => {
    it("preserves the quotes inside the token span — they're part of the value", () => {
      const plan = buildDecorationPlan('errorMessage:"rate limit"');
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        {
          from: 0,
          to: 'errorMessage:"rate limit"'.length,
          className: "filter-token",
        },
      ]);
      // Widget delete payload carries the unquoted value.
      expect(plan.tokens).toEqual([
        {
          start: 0,
          end: 25,
          field: "errorMessage",
          value: "rate limit",
        },
      ]);
    });

    it("a bare quoted free-text token does NOT emit a widget — no field name", () => {
      const plan = buildDecorationPlan('"refund policy"');
      // ImplicitField — no chip, no X widget. The walkAst early-return
      // for isImplicit is what makes this true.
      expect(plan.tokens).toEqual([]);
      expect(
        plan.slots.some((s) => s.className.includes("filter-token")),
      ).toBe(false);
    });
  });

  describe("scenario field accent", () => {
    it.each([
      "scenario",
      "scenarioRun",
      "scenarioSet",
      "scenarioBatch",
      "scenarioVerdict",
      "scenarioStatus",
    ])("`%s:foo` gets the scenario class", (field) => {
      const plan = buildDecorationPlan(`${field}:foo`);
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots[0]?.className).toContain("filter-token-scenario");
    });
  });

  describe("numeric field accent", () => {
    it.each([
      "duration",
      "cost",
      "tokens",
      "spans",
      "promptTokens",
      "completionTokens",
      "tokensPerSecond",
    ])("`%s:>5` gets the numeric class", (field) => {
      const plan = buildDecorationPlan(`${field}:>5`);
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots[0]?.className).toContain("filter-token-numeric");
    });
  });

  describe("negation interaction with field-type accents", () => {
    it("a NOT-prefixed scenario field gets the exclude class — exclude wins over scenario", () => {
      const plan = buildDecorationPlan("NOT scenarioVerdict:success");
      const tokenSlot = plan.slots.find((s) =>
        s.className.includes("filter-token"),
      );
      // Token-class precedence: negated > scenario > numeric > default.
      expect(tokenSlot?.className).toBe("filter-token filter-token-exclude");
    });

    it("a `-` prefixed numeric field gets the exclude class", () => {
      const plan = buildDecorationPlan("-cost:>5");
      const tokenSlot = plan.slots.find((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlot?.className).toBe("filter-token filter-token-exclude");
    });
  });

  describe("partial typing — chip evolution one keystroke at a time", () => {
    // Pin the per-keystroke decoration plan as a user types `status:error`.
    // Each step is what the editor would render BETWEEN keystrokes — used
    // by the user to decide whether to keep typing. If any of these change,
    // the SearchBar's typing UX changes too.
    //
    // NB: liqe parses `status:` as a Tag with EmptyExpression — so a chip
    // appears as soon as the colon lands, even though there's no value
    // yet. The widget's `data-value` is omitted (value: null). The user
    // sees a half-built chip while typing the value.
    it.each([
      // [partial input, expected token slots, expected widgets]
      ["s", 0, 0],
      ["st", 0, 0],
      ["sta", 0, 0],
      ["stat", 0, 0],
      ["statu", 0, 0],
      ["status", 0, 0],
      ["status:", 1, 1], // chip + widget appear at the colon (no value yet)
      ["status:e", 1, 1],
      ["status:er", 1, 1],
      ["status:err", 1, 1],
      ["status:erro", 1, 1],
      ["status:error", 1, 1],
    ])(
      "after typing %j: %d filter-token slot(s), %d delete widget(s)",
      (input, expectedTokens, expectedWidgets) => {
        const plan = buildDecorationPlan(input);
        const tokenSlots = plan.slots.filter((s) =>
          s.className.includes("filter-token"),
        );
        expect(
          tokenSlots.length,
          `tokens for ${JSON.stringify(input)}`,
        ).toBe(expectedTokens);
        expect(
          plan.tokens.length,
          `widgets for ${JSON.stringify(input)}`,
        ).toBe(expectedWidgets);
      },
    );

    it("the half-built `status:` widget carries a null value (no `data-value` on the X)", () => {
      const plan = buildDecorationPlan("status:");
      expect(plan.tokens).toEqual([
        { start: 0, end: 7, field: "status", value: null },
      ]);
    });
  });

  describe("partial typing — never emits a delete widget on free text", () => {
    // Critical regression: previously the X button rendered for any tag
    // including ImplicitField. Now it only renders on recognised
    // `field:value` tags.
    it.each([
      "A",
      "AN",
      "AND",
      "refund",
      "refund policy",
      '"refund"',
    ])("typed `%s` produces zero delete widgets", (input) => {
      expect(buildDecorationPlan(input).tokens).toEqual([]);
    });
  });

  describe("partial typing — chip transitions from null-value → real-value cleanly", () => {
    it("`status:` → `status:e` keeps one widget but the value flips from null to `e`", () => {
      const before = buildDecorationPlan("status:");
      const after = buildDecorationPlan("status:e");

      expect(before.tokens).toEqual([
        { start: 0, end: 7, field: "status", value: null },
      ]);
      expect(after.tokens).toEqual([
        { start: 0, end: 8, field: "status", value: "e" },
      ]);
    });
  });

  describe("partial typing — extending a query keeps existing widgets stable", () => {
    it("adding ` AND model:` does NOT erase the first widget; second appears once a value lands", () => {
      const a = buildDecorationPlan("status:error");
      const b = buildDecorationPlan("status:error AND model:");
      const c = buildDecorationPlan("status:error AND model:gpt-4o");

      expect(a.tokens).toEqual([
        { start: 0, end: 12, field: "status", value: "error" },
      ]);

      // `model:` with no value mid-clause means the parse fails (the AND
      // dangles syntactically). The regex fallback still recognises
      // `status:error` as a token, so its decoration survives — but no
      // widgets are emitted from the fallback path.
      const bTokens = b.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(bTokens.length).toBeGreaterThanOrEqual(1);
      // Either fallback (no widgets) or full parse — both keep the first
      // status token decorated. We don't assert exact widget count here
      // because the parser could legitimately go either way, but the
      // FIRST status:error must survive structurally.
      expect(bTokens[0]?.from).toBe(0);
      expect(bTokens[0]?.to).toBe(12);

      expect(c.tokens).toEqual([
        { start: 0, end: 12, field: "status", value: "error" },
        { start: 17, end: 29, field: "model", value: "gpt-4o" },
      ]);
    });
  });

  describe("partial typing — backspacing through a value reflows correctly", () => {
    it("typed `status:error` then backspaces keeps exactly one widget at every stage (chip survives empty value)", () => {
      // Each step is what the highlighter sees on the next render. The
      // half-built Tag (EmptyExpression) still gets a chip — same shape
      // as the colon-just-pressed state above.
      const steps = ["status:error", "status:erro", "status:err", "status:er", "status:e", "status:"];
      const tokenCounts = steps.map((s) => buildDecorationPlan(s).tokens.length);
      expect(tokenCounts).toEqual([1, 1, 1, 1, 1, 1]);
    });

    it("one more backspace (drops the colon) makes the chip disappear", () => {
      // `status` is just an identifier — no field:value shape, so no chip.
      expect(buildDecorationPlan("status").tokens).toEqual([]);
    });
  });

  describe("partial typing — silent miscarriages still light up a fallback chip", () => {
    it("`status: error` (space after colon) renders the empty `status:` chip but `error` stays free-text", () => {
      // Liqe parses this as a LogicalExpression of an empty `status:` and
      // free-text `error`. The empty `status:` arm gets a chip (since it
      // *is* a Tag, even with EmptyExpression). The free-text `error` is
      // ImplicitField — no chip. So the user sees one half-built chip and
      // an unstyled trailing word — a visible signal that the clause split.
      const plan = buildDecorationPlan("status: error");
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 7, className: "filter-token" },
      ]);
      // Only one widget — for the empty status: chip. The free-text arm
      // never gets a delete affordance.
      expect(plan.tokens).toEqual([
        { start: 0, end: 7, field: "status", value: null },
      ]);
    });

    it("`NOT-status:error` (no space after NOT) lights up a chip, but with field name `NOT-status`", () => {
      const plan = buildDecorationPlan("NOT-status:error");
      // The user thinks they wrote a negation; the parser accepted it as
      // a literal field. Visually they get one chip with the WHOLE
      // `NOT-status:error` highlighted in default blue (not red exclude).
      const tokenSlot = plan.slots.find((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlot?.className).toBe("filter-token");
      // Widget will carry the literal-field name — a future "you can't
      // query this field" hint could trigger off this.
      expect(plan.tokens).toEqual([
        {
          start: 0,
          end: "NOT-status:error".length,
          field: "NOT-status",
          value: "error",
        },
      ]);
    });
  });

  describe("partial typing — paren forms", () => {
    it("`(` alone falls back to regex (no chip)", () => {
      expect(buildDecorationPlan("(").slots).toEqual([]);
    });

    it("`(status:error` (unmatched) falls back to regex but recognises the inner tag", () => {
      const plan = buildDecorationPlan("(status:error");
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      // The regex matches `status:error` from offset 1.
      expect(tokenSlots).toEqual([
        { from: 1, to: 13, className: "filter-token" },
      ]);
      // No widgets from the regex fallback.
      expect(plan.tokens).toEqual([]);
    });

    it("`(status:error)` parses cleanly: 2 paren slots + 1 token + 1 widget", () => {
      const plan = buildDecorationPlan("(status:error)");
      const parens = plan.slots.filter((s) => s.className === "filter-paren");
      expect(parens).toHaveLength(2);
      // The walker emits the inner Tag as a token + widget.
      expect(plan.tokens).toEqual([
        { start: 1, end: 13, field: "status", value: "error" },
      ]);
    });
  });

  describe("partial typing — leading whitespace offsets are exact", () => {
    it("`   status:error` shifts both the slot AND the widget position by leadingWs", () => {
      const plan = buildDecorationPlan("   status:error");
      const tokenSlot = plan.slots.find((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlot).toEqual({
        from: 3,
        to: 15,
        className: "filter-token",
      });
      // leadingWs is exposed on the plan so the editor can position the
      // widget correctly. Absolute end = leadingWs + token.end.
      expect(plan.leadingWs).toBe(3);
      expect(plan.tokens).toEqual([
        { start: 0, end: 12, field: "status", value: "error" },
      ]);
    });
  });

  describe("partial typing — NBSP normalisation", () => {
    it("after value-accept, the highlighter normalises U+00A0 → space before parsing", () => {
      // The editor inserts NBSP after a value-accept so contenteditable
      // doesn't collapse the trailing space. The highlighter must NOT
      // fuse the next clause — confirm the AND keyword is recognised.
      const plan = buildDecorationPlan("status:error\u00A0AND model:gpt-4o");
      expect(plan.tokens).toEqual([
        { start: 0, end: 12, field: "status", value: "error" },
        { start: 17, end: 29, field: "model", value: "gpt-4o" },
      ]);
      // AND is recognised as a keyword, not absorbed into a value.
      expect(
        plan.slots.some((s) => s.className.includes("filter-keyword-and")),
      ).toBe(true);
    });
  });

  describe("partial typing — incremental wildcards", () => {
    // While the user is in the middle of typing a wildcard value, the
    // chip should remain stable (no flicker between recognised/not).
    it.each([
      ["model:g", { start: 0, end: 7, field: "model", value: "g" }],
      ["model:gp", { start: 0, end: 8, field: "model", value: "gp" }],
      ["model:gpt", { start: 0, end: 9, field: "model", value: "gpt" }],
      ["model:gpt-", { start: 0, end: 10, field: "model", value: "gpt-" }],
      ["model:gpt-*", { start: 0, end: 11, field: "model", value: "gpt-*" }],
    ])("after %j the widget reflects the typed value verbatim", (input, expected) => {
      const plan = buildDecorationPlan(input);
      expect(plan.tokens).toEqual([expected]);
    });
  });

  describe("given an unquoted value followed immediately by AND with no space", () => {
    it("parses as one Tag whose value contains the literal `AND` — liqe doesn't strip operator-shaped substrings from inside unquoted values", () => {
      // This is the silent-failure mode: if the user's space gets eaten,
      // `model:gpt-*AND` round-trips to a Tag with value `gpt-*AND`, no
      // AND keyword recognised. The test pins that behaviour so a future
      // regression that DOES strip the space would show up loudly.
      const plan = buildDecorationPlan("model:gpt-*AND");
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 14, className: "filter-token" },
      ]);
      expect(plan.tokens).toEqual([
        { start: 0, end: 14, field: "model", value: "gpt-*AND" },
      ]);
      // No AND keyword decoration — there is no boolean operator in the AST.
      expect(
        plan.slots.some((s) => s.className.includes("filter-keyword-and")),
      ).toBe(false);
    });
  });
});
