# ragas 0.4.3 reference for the Go port of langevals (all 13 ragas evaluators)

Covers the 13 evaluators of the `ragas/*` catalogue: 9 LLM/embedding/text metrics (sections 3.1-3.7, 4.5, 4.6),
the LLM-judged `response_context_precision` (3.8) and the three non-LLM string-distance evaluators
`context_precision`, `context_recall`, `context_f1` (4.2-4.4).

Source of truth: the installed `ragas==0.4.3` package (legacy `ragas.metrics._*` classes, which is what
`from ragas.metrics import X` resolves to, via a deprecated `__getattr__`), plus our wrapper code in
`services/langevals/evaluators/ragas/langevals_ragas/*.py`. Every prompt block in section 6 is _rendered by
running ragas_ (`PydanticPrompt.to_string`), not retyped. Versions pinned in `services/langevals/uv.lock`:
ragas 0.4.3, pydantic 2.13.4, sacrebleu 2.6.0, rouge-score 0.1.2, rapidfuzz 3.14.5, nltk 3.10.2, langchain-core 0.3.86,
langchain-openai 0.3.35, langchain-community 0.3.31.

Source paths quoted below (`ragas/metrics/_faithfulness.py` etc.) are relative to the installed package
(`site-packages/`, from a throwaway venv with `pip install ragas==0.4.3`, since deleted).

The call sequences, temperatures, `n`, retry counts and parse-failure behaviour in this file were also verified by
running the real ragas classes against a fake `litellm.completion`; the rapidfuzz-based metrics were verified
against a pure-Python reference (section 4.1) over ~140,000 random string pairs and 1,600 random context sets.

### Evaluator map (catalogue id -> wrapper file -> ragas class)

| catalogue evaluator              | wrapper file (`langevals_ragas/`) | ragas class actually run                                                                                      | kind                 | section |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- | ------- |
| ragas/faithfulness               | `faithfulness.py`                 | `Faithfulness`                                                                                                | LLM x2 (+1)          | 3.1     |
| ragas/factual_correctness        | `factual_correctness.py`          | `FactualCorrectness`                                                                                          | LLM x4 or x2         | 3.2     |
| ragas/response_context_recall    | `response_context_recall.py`      | `LLMContextRecall` (confirmed: `from ragas.metrics import LLMContextRecall`)                                  | LLM x1               | 3.3     |
| ragas/response_relevancy         | `response_relevancy.py`           | `ResponseRelevancy`                                                                                           | LLM n=3 + embeddings | 3.4     |
| ragas/summarization_score        | `summarization_score.py`          | `SummarizationScore`                                                                                          | LLM x3               | 3.5     |
| ragas/rubrics_based_scoring      | `rubrics_based_scoring.py`        | `InstanceRubrics`                                                                                             | LLM x1               | 3.6     |
| ragas/sql_query_equivalence      | `sql_query_equivalence.py`        | `LLMSQLEquivalence`                                                                                           | LLM x1               | 3.7     |
| ragas/response_context_precision | `response_context_precision.py`   | `LLMContextPrecisionWithReference` if `expected_output` is truthy, else `LLMContextPrecisionWithoutReference` | LLM x N contexts     | 3.8     |
| ragas/context_precision          | `context_precision.py`            | `NonLLMContextPrecisionWithReference` + `NonLLMStringSimilarity`                                              | rapidfuzz            | 4.2     |
| ragas/context_recall             | `context_recall.py`               | `NonLLMContextRecall` (NOT the LLM one)                                                                       | rapidfuzz            | 4.3     |
| ragas/context_f1                 | `context_f1.py`                   | `NonLLMContextPrecisionWithReference` + `NonLLMContextRecall`                                                 | rapidfuzz            | 4.4     |
| ragas/bleu_score                 | `bleu_score.py`                   | `BleuScore`                                                                                                   | sacrebleu            | 4.5     |
| ragas/rouge_score                | `rouge_score.py`                  | `RougeScore`                                                                                                  | rouge_score          | 4.6     |

(`response_context_recall` is the LLM recall; the plain `context_recall` id is the non-LLM one. Do not conflate them.)

## Contents

1. How one LLM call is made (transport, temperature, n, finish_reason, retries)
2. How a prompt is rendered, parsed and repaired (shared)
3. LLM-judged metrics: 3.1 Faithfulness, 3.2 FactualCorrectness, 3.3 LLMContextRecall, 3.4 ResponseRelevancy,
   3.5 SummarizationScore, 3.6 InstanceRubrics, 3.7 LLMSQLEquivalence, 3.8 LLMContextPrecision (response_context_precision)
4. Non-LLM metrics: 4.1 rapidfuzz string distances (shared, with verified reference code), 4.2 context_precision,
   4.3 context_recall, 4.4 context_f1, 4.5 BLEU, 4.6 ROUGE
5. Gotchas for the Go port (collected)
6. Prompts (generated verbatim from ragas, every LLM prompt with its few-shot examples)

---

## 1. How one LLM call is made

Wrapper chain (`langevals_ragas/lib/common.py::prepare_llm`, `lib/model_to_langchain.py`):

- `model_to_langchain(model, temperature, extra_call_kwargs)`:
  - `claude-*` models are rewritten to `anthropic/claude-*`.
  - if `"gpt-5" in model` then `temperature = 1.0`.
  - builds `ChatOpenAI(model=model, api_key="dummy", temperature=temperature or 0, client=LitellmCompletion(temperature, extra_call_kwargs), async_client=AsyncLitellmCompletion(...))`.
- `LitellmCompletion.create(**kwargs)`: `if self.temperature: kwargs["temperature"] = self.temperature` (so a NON-ZERO configured temperature
  _overrides_ whatever ragas asked for; a zero one does not), then `kwargs["drop_params"] = True`, then `kwargs.update(extra_call_kwargs)`
  (azure `api_version` "2024-02-01" for azure models), then `litellm.completion(**kwargs)`. The async client calls the _sync_ `litellm.completion`
  (blocking).
- `prepare_llm(..., temperature=0)` default; only ResponseRelevancy passes `temperature=0.7`. So the temperature actually sent is:

| evaluator                                     | configured temp                                                 | temperature in request                                                                      | n                                            |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| all except ResponseRelevancy, model not gpt-5 | 0                                                               | **0.01** (ragas `get_temperature(n=1)`; not overridden because 0 is falsy)                  | 1                                            |
| ResponseRelevancy                             | 0.7                                                             | **0.7** (overrides ragas' 0.3 for n>1)                                                      | **3** (`strictness`), ONE request with `n=3` |
| any evaluator, gpt-5 model                    | 1.0                                                             | **1.0**                                                                                     | as above                                     |
| Faithfulness "I don't know" check             | (sets `llm.langchain_llm.temperature = 0` then calls `.invoke`) | 0 (payload temperature 0; client override not applied since client temp is 0 for non-gpt-5) | 1                                            |

Request kwargs observed at `litellm.completion` (verified): `{"model": <settings.model>, "stream": False, "n": 1|3, "temperature": ..., "drop_params": True, "messages": [{"role": "user", "content": <prompt string>}]}`.
There is exactly ONE message, role `user`, no system message, no `max_tokens`, no `stop`, no timeout, no response_format/JSON mode.
The whole rendered prompt string (section 2) is the user message.

`LangchainLLMWrapper.is_finished` (`ragas/llms/base.py`): after each generate, every generation's `finish_reason` must be in
`["stop","STOP","MAX_TOKENS","eos_token"]` (or `stop_reason` in `["end_turn","stop","STOP","MAX_TOKENS","eos_token"]`);
`"length"` (or `tool_calls`, `content_filter`, ...) raises `LLMDidNotFinishException` ("The LLM generation was not completed. Please increase the max_tokens and try again.")
which is NOT retried and propagates (verified). Missing finish_reason counts as finished.

Retries (`ragas/run_config.py`, `LangchainLLMWrapper.set_run_config`): `RunConfig(timeout=180, max_retries=10, max_wait=60, max_workers=16, exception_types=(Exception,), seed=42)`.
Because the langchain LLM is a `ChatOpenAI`, `set_run_config` sets `run_config.exception_types = openai.RateLimitError` (litellm's `RateLimitError` subclasses it).
`add_async_retry` wraps ONLY `agenerate_text`: `AsyncRetrying(wait=wait_random_exponential(multiplier=1, max=60), stop=stop_after_attempt(10), retry=retry_if_exception_type(RateLimitError), reraise=True)`.
=> only rate-limit errors are retried (up to 10 attempts, random exponential backoff capped at 60 s); every other provider error propagates immediately and becomes an evaluator error. The `is_finished` check happens after the retry wrapper.
`ChatOpenAI` client-level `max_retries` is irrelevant (custom client supplied); `request_timeout=180` is set on the ChatOpenAI object but is not passed to litellm (verified: no timeout kwarg).

Generation `n` handling (`LangchainLLMWrapper.agenerate_text`): `hasattr(ChatOpenAI, "n")` is true, so `langchain_llm.n = n` and ONE request is made
with `n=n`; the n choices are read as `generations[0][i]`. (`BaseRagasLLM.get_temperature(n) = 0.3 if n > 1 else 0.01`.)

## 2. Prompt rendering, JSON parsing and output repair (shared)

### 2.1 `PydanticPrompt.to_string` (ragas/prompt/pydantic_prompt.py) -- verbatim source

```python
    def _generate_output_signature(self, indent: int = 4) -> str:
        return (
            f"Please return the output in a JSON format that complies with the "
            f"following schema as specified in JSON Schema:\n"
            f"{json.dumps(self.output_model.model_json_schema())}"
            "Do not use single quotes in your response but double quotes,"
            "properly escaped with a backslash."
        )

    def _generate_examples(self):
        if self.examples:
            example_strings = []
            for idx, e in enumerate(self.examples):
                input_data, output_data = e
                example_strings.append(
                    f"Example {idx + 1}\n"
                    + "Input: "
                    + input_data.model_dump_json(indent=4)
                    + "\n"
                    + "Output: "
                    + output_data.model_dump_json(indent=4)
                )

            return "\n--------EXAMPLES-----------\n" + "\n\n".join(example_strings)
        # if no examples are provided
        else:
            return ""

    def to_string(self, data: t.Optional[InputModel] = None) -> str:
        return (
            f"{self.instruction}\n"
            + self._generate_output_signature()
            + "\n"
            + self._generate_examples()
            + "\n-----------------------------\n"
            + "\nNow perform the same with the following input\n"
            + (
                "input: " + data.model_dump_json(indent=4, exclude_none=True) + "\n"
                if data is not None
                else "Input: (None)\n"
            )
            + "Output: "
        )
```

Rendered shape (`<...>` = variable; note there is NO newline between the end of the JSON schema and "Do not use single quotes", and NO space after the comma in "double quotes,properly"):

```text
<instruction>\n
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:\n
<json.dumps(OutputModel.model_json_schema())>Do not use single quotes in your response but double quotes,properly escaped with a backslash.\n
<examples block, or "" if none>\n
-----------------------------\n
\n
Now perform the same with the following input\n
input: <InputModel.model_dump_json(indent=4, exclude_none=True)>\n
Output:
```

(the last line is `Output: ` with a trailing space and no newline). `<examples block>` is
`"\n--------EXAMPLES-----------\n" + "\n\n".join("Example {i+1}\nInput: " + in.model_dump_json(indent=4) + "\nOutput: " + out.model_dump_json(indent=4))` (1-based; examples use `model_dump_json(indent=4)` WITHOUT exclude_none).
Details that matter for byte-exact parity:

- `instruction` is used raw. Several instructions are triple-quoted with leading/trailing newlines and 4-space indentation (FactualCorrectness claim decomposition, SQL equivalence); the repr in section 6 shows the exact whitespace.
- The output schema is `json.dumps(model.model_json_schema())` (Python default separators `", "` and `": "`, `ensure_ascii=True`, key order as pydantic emits: `properties`, `required`, `title`, `type`, plus `$defs` first where nested models exist). Copy the strings from section 6 verbatim rather than re-deriving them.
- `model_dump_json(indent=4)` is pydantic's serializer: 4-space indent, `": "` separator, non-ASCII NOT escaped, `<`,`>`,`&` NOT escaped, only `"`, `\\` and control characters escaped (`\n`, `\t`, `\u00XX`); empty list renders as `[]`; field order = model field declaration order. Go's `encoding/json` escapes `<`,`>`,`&` and U+2028/2029 by default: use `SetEscapeHTML(false)` and handle 2028/2029 to match.
- `exclude_none=True` on the _input_ drops None fields (e.g. InstanceRubrics with no reference omits `reference`; Faithfulness with `input=""` keeps `"question": ""` because "" is not None).
- The prompt string is sent as ONE user message via langchain `StringPromptValue` -> `[HumanMessage(content=text)]`.

### 2.2 `generate` / `generate_multiple` control flow

`PydanticPrompt.generate(llm, data)` = `generate_multiple(n=1)[0]`. `generate_multiple(llm, data, n=1, temperature=None, stop=None, retries_left=3)`:

1. `processed = self.process_input(data)` (identity), `prompt_value = StringPromptValue(text=self.to_string(processed))`.
2. `LangchainLLMWrapper` is a `BaseRagasLLM` (not a langchain `BaseLanguageModel`), so it takes the "standard BaseRagasLLM" branch: `resp = await llm.generate(prompt_value, n=n, temperature=None, stop=None)` (temperature None -> `get_temperature(n)`), retried on RateLimitError as in section 1, then `is_finished` check.
3. For each of the `n` generations: `RagasOutputParser.parse_output_string(output_string, prompt_value, llm, retries_left=3)`.
4. If fewer generations than requested come back it proceeds with the ones available; zero generations -> `ValueError`.

### 2.3 Output parsing (`RagasOutputParser`, `extract_json`) -- verbatim source

````python
class RagasOutputParser(PydanticOutputParser[OutputModel]):
    async def parse_output_string(
        self,
        output_string: str,
        prompt_value: PromptValue,
        llm: BaseRagasLLM,
        callbacks: Callbacks,
        retries_left: int = 1,
    ) -> OutputModel:
        callbacks = callbacks or []
        try:
            jsonstr = extract_json(output_string)
            result = super().parse(jsonstr)
        except OutputParserException:
            if retries_left != 0:
                retry_rm, retry_cb = new_group(
                    name="fix_output_format",
                    inputs={"output_string": output_string},
                    callbacks=callbacks,
                )
                fixed_output_string = await fix_output_format_prompt.generate(
                    llm=llm,
                    data=OutputStringAndPrompt(
                        output_string=output_string,
                        prompt_value=prompt_value.to_string(),
                    ),
                    callbacks=retry_cb,
                    retries_left=retries_left - 1,
                )
                retry_rm.on_chain_end({"fixed_output_string": fixed_output_string})
                result = super().parse(fixed_output_string.text)
            else:
                raise RagasOutputParserException()
        return result

def extract_json(text: str) -> str:
    """Identify json from a text blob by matching '[]' or '{}'.

    Warning: This will identify the first json structure!"""

    # check for markdown indicator; if present, start there
    md_json_idx = text.find("```json")
    if md_json_idx != -1:
        text = text[md_json_idx:]

    # search for json delimiter pairs
    left_bracket_idx = text.find("[")
    left_brace_idx = text.find("{")

    indices = [idx for idx in (left_bracket_idx, left_brace_idx) if idx != -1]
    start_idx = min(indices) if indices else None

    # If no delimiter found, return the original text
    if start_idx is None:
        return text

    # Identify the exterior delimiters defining JSON
    open_char = text[start_idx]
    close_char = "]" if open_char == "[" else "}"

    # Initialize a count to keep track of delimiter pairs
    count = 0
    for i, char in enumerate(text[start_idx:], start=start_idx):
        if char == open_char:
            count += 1
        elif char == close_char:
            count -= 1

        # When count returns to zero, we've found a complete structure
        if count == 0:
            return text[start_idx : i + 1]

    return text  # In case of unbalanced JSON, return the original text
````

`super().parse(jsonstr)` is langchain-core 0.3.86 `PydanticOutputParser.parse` -> `parse_json_markdown` (`langchain_core/utils/json.py`): strips `" \n\r\t\`"` from both ends, escapes raw newlines/tabs inside JSON string values (`_custom_parser`),
then `parse_partial_json`(**tolerates truncated JSON**: unterminated strings/arrays/objects are auto-closed; verified`{"answers": ["1","0"`parses to`['1','0']`), falling back to the content inside a ```` ```json ```` fence. Then `model_validate` (pydantic v2 lax mode, extra keys ignored). Verified behaviours:

- trailing comma `{"a": [1,],}` -> fail; single-quoted JSON -> fail; no braces -> fail (all -> `OutputParserException`, triggers the repair path).
- `int` fields: accept `4`, `"4"`, `4.0`, `true` (-> 1); reject `4.5`. `bool` fields accept `true`, `"true"`, `"True"`, `"yes"`, `1`, `0`, ... (pydantic lax bool). `str` fields REJECT numbers (`{"answers": [1,0]}` for `list[str]` fails validation -> repair path).
- `extract_json` returns the first balanced `{...}` or `[...]` (whichever opens first; counting only the opener/closer of that type, ignoring braces inside strings), starting at a ` ```json ` marker if present; if unbalanced returns the whole text.

### 2.4 Repair (`fix_output_format`) and the failure budget

On `OutputParserException` and `retries_left != 0`: call `fix_output_format_prompt.generate(llm, data=OutputStringAndPrompt(output_string=<bad output>, prompt_value=<the full original prompt string>), retries_left=retries_left-1)`
(output model `StringIO{text: str}`), then `super().parse(fixed.text)` -- NOTE: no `extract_json` on the fixed text, and a parse failure here is NOT caught (raises `OutputParserException` straight out).
The repair call is itself a `generate`, so its own output goes through the same parse+repair logic with `retries_left` decremented. When `retries_left == 0` and parsing fails: `raise RagasOutputParserException()`
("The output parser failed to parse the output including retries.").
Verified call counts (top-level `retries_left=3`): valid output = 1 call; one bad output then a valid `{"text": "<json string>"}` repair = 2 calls; persistently bad output = 1 original + 3 repair calls = **4 calls then `RagasOutputParserException`** (propagates as an evaluator error).
The repair prompt text is rendered in section 6 (`fix_output_format`); `prompt_value` in its input is the complete original prompt string JSON-escaped inside the `input:` block.

Support classes verbatim:

```python
class OutputStringAndPrompt(BaseModel):
    output_string: str
    prompt_value: str

class FixOutputFormat(PydanticPrompt[OutputStringAndPrompt, StringIO]):
    instruction = "The output string did not satisfy the constraints given in the prompt. Fix the output string and return it."
    input_model = OutputStringAndPrompt
    output_model = StringIO
```

```python
class StringIO(BaseModel):
    text: str
```

### 2.5 Sample plumbing common to all metrics

`metric.single_turn_score(sample)` -> `_only_required_columns_single_turn`: `SingleTurnSample(**sample.model_dump(include=required_columns_with_optional))`,
then `sample.to_dict()` = `model_dump(exclude_none=True)` before the metric reads `row[...]`. So `None` fields never reach the metric; empty strings do.
There is no timeout on the score call (`run(_async_wrapper)`). Any exception propagates out of `evaluate()`.

Common wrapper pieces (`langevals_ragas/lib/common.py`), used by all LLM metrics:

- `RagasSettings`: `model` (default `openai/gpt-5-mini`), `max_tokens` (default 2048).
- `check_max_tokens(...)`: sums `len(litellm.encode(model=settings.model, text=t))` over `input or ""`, `output or ""`, `expected_output or ""` and EACH context individually; `limit = min(settings.max_tokens, MAX_TOKENS_HARD_LIMIT=1_048_576)`;
  if `total > limit` -> `EvaluationResultSkipped(details=f"Total tokens exceed the maximum of {limit}: {total}")`. This is a SKIP, not a truncation: the Ragas evaluators do NOT use `langevals_core/token_budget.py` (fit/cut-with-elision); nothing is ever truncated.
- `clear_context(contexts)`: drops falsy (empty-string) contexts (used only by Faithfulness).
- `capture_cost(llm)`: wraps the call in `get_openai_callback()` (sums prompt/completion tokens across ALL LLM calls incl. repairs and the Faithfulness don't-know call) and prices via `litellm.cost_per_token(model=llm.langchain_llm.model_name, ...)`; unmapped model -> cost stays 0 (`Money(amount=0, currency="USD")`). Embedding calls are not counted.
- Result type `RagasResult(EvaluationResult)`: `score: float`, `cost`, `details`; `passed`/`label` unset (None) unless stated.

---

## 3. LLM-judged metrics

(Prompts are in section 6, at the end of the file; each metric lists which prompt it uses. Sections 3 and 4 together cover all 13 catalogue evaluators, see the map in the header.)

### 3.1 Faithfulness (wrapper `faithfulness.py`, ragas `metrics/_faithfulness.py::Faithfulness`)

Entry: `input: Optional[str] = ""`, `output: str`, `contexts: list[str]`. Settings: `RagasSettings` + `autodetect_dont_know: bool = True`.

Flow:

1. `contexts = clear_context(entry.contexts)`; `check_max_tokens(input, output, contexts)` -> skip if too large.
2. Sample: `user_input=entry.input` ("" allowed), `response=entry.output`, `retrieved_contexts=contexts`.
3. **LLM call 1** `StatementGeneratorPrompt`: input `{question: user_input, answer: response}` -> `{statements: [str]}`. If `statements == []` the metric returns NaN (no call 2).
4. **LLM call 2** `NLIStatementPrompt`: input `{context: "\n".join(retrieved_contexts), statements: <the list from call 1>}` -> `{statements: [{statement, reason, verdict:int}]}`.
5. Score: verbatim below. Denominator is the number of verdict objects the LLM returned (NOT the number of statements sent).
6. Wrapper: if no statements were generated or score is NaN -> `EvaluationResultSkipped(details="No claims found in the output to measure faitfhulness against context, skipping entry.")` (typo `faitfhulness` is in the source).
7. Details (verdict objects from call 2; if none, the statements): each `Claim: "{statement}"\nVerdict: {reason}\nScore: {verdict}`, joined by `"\n\n"`; fallback `Claim: "{statement}"` joined by `"\n\n"`.
8. **Optional LLM call 3** ("don't know" detector, plain langchain `.invoke`, NOT through ragas prompts/parsing/retries): only if `autodetect_dont_know and score < 0.1`. Sets temperature 0. If `"true" in response.content.lower()` -> `EvaluationResultSkipped(details="The output seems correctly to be an 'I don't know' statement given the provided contexts. Skipping faithfulness score.")`. Exact prompt text (the f-string keeps its source indentation, incl. the leading newline and 24-space indents, and the trailing newline + spaces):

```python
                    input=StringPromptValue(
                        text=f"""
                        You are an LLM evaluator. You are given an output generated by another LLM and you need to determine if it is a 'I don't know', 'I don't have the information', 'I couldn't find anything' or 'I can't help you' statement. If it is, return True, otherwise return False. Return nothing else, only True or False.

                        Generated output:
                        > {entry.output}
                        """
                    ),
```

9. Result `RagasResult(score=score, cost=cost, details=details)`.

Score arithmetic (verbatim):

```python
    def _compute_score(self, answers: NLIStatementOutput):
        # check the verdicts and compute the score
        faithful_statements = sum(
            1 if answer.verdict else 0 for answer in answers.statements
        )
        num_statements = len(answers.statements)
        if num_statements:
            score = faithful_statements / num_statements
        else:
            logger.warning("No statements were generated from the answer.")
            score = np.nan

        return score

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        """
        returns the NLI score for each (q, c, a) pair
        """
        assert self.llm is not None, "LLM is not set"

        statements = await self._create_statements(row, callbacks)
        statements = statements.statements
        if statements == []:
            return np.nan

        verdicts = await self._create_verdicts(row, statements, callbacks)
        return self._compute_score(verdicts)
```

LLM calls: 2 normally (1 if no statements -> skipped), +1 when score < 0.1 and autodetect on. Each ragas call may add up to 3 repair calls.

Wrapper source (verbatim), including the ragas>=0.3 vs <=0.2 `statements` shape shim (0.4.3 uses the flat `.statements`):

```python
    def evaluate(self, entry: RagasFaithfulnessEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        contexts = clear_context(entry.contexts)
        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            contexts=contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = Faithfulness()
        scorer.llm = llm

        _original_create_statements = scorer._create_statements
        _original_create_verdicts = scorer._create_verdicts
        ragas_statements = []
        ragas_verdicts = []

        async def _create_statements(self, row: dict, callbacks):
            nonlocal ragas_statements
            statements = await _original_create_statements(row, callbacks)
            # ragas >= 0.3 returns StatementGeneratorOutput with a flat
            # `.statements: list[str]`. ragas <= 0.2 returned SentencesSimplified
            # with `.sentences[].simpler_statements`. Support both so this works
            # on the deployed pin and older local pins alike.
            if hasattr(statements, "statements"):
                ragas_statements += statements.statements
            else:
                for components in statements.sentences:
                    ragas_statements += components.simpler_statements
            return statements

        scorer._create_statements = _create_statements.__get__(scorer)

        async def _create_verdicts(self, row: dict, statements: list[str], callbacks):
            nonlocal ragas_verdicts
            verdicts = await _original_create_verdicts(row, statements, callbacks)
            ragas_verdicts += verdicts.statements
            return verdicts

        scorer._create_verdicts = _create_verdicts.__get__(scorer)

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                    retrieved_contexts=contexts,
                )
            )

            if len(ragas_statements) == 0 or math.isnan(score):
                return EvaluationResultSkipped(
                    details="No claims found in the output to measure faitfhulness against context, skipping entry."
                )

            details = "\n\n".join(
                [
                    f'Claim: "{verdict.statement}"\nVerdict: {verdict.reason}\nScore: {verdict.verdict}'
                    for verdict in ragas_verdicts
                ]
            )

            if len(details) == 0:
                details = "\n\n".join(
                    [f'Claim: "{statement}"' for statement in ragas_statements]
                )

            if self.settings.autodetect_dont_know and score < 0.1:
                llm.langchain_llm.temperature = 0  # type: ignore
                is_dont_know = llm.langchain_llm.invoke(
                    input=StringPromptValue(
                        text=f"""
                        You are an LLM evaluator. You are given an output generated by another LLM and you need to determine if it is a 'I don't know', 'I don't have the information', 'I couldn't find anything' or 'I can't help you' statement. If it is, return True, otherwise return False. Return nothing else, only True or False.

                        Generated output:
                        > {entry.output}
                        """
                    ),
                )
                if "true" in is_dont_know.content.lower():  # type: ignore
                    return EvaluationResultSkipped(
                        details="The output seems correctly to be an 'I don't know' statement given the provided contexts. Skipping faithfulness score."
                    )

        return RagasResult(
            score=score,
            cost=cost,
            details=details,
        )
```

### 3.2 FactualCorrectness (wrapper `factual_correctness.py`, ragas `metrics/_factual_correctness.py`)

Entry: `output: str`, `expected_output: str`. Settings: `mode` in {f1 (default), precision, recall}, `atomicity` in {low (default), high}, `coverage` in {low (default), high}; plus `model`, `max_tokens`. `beta` = 1.0 (not exposed).
`FactualCorrectness(llm=llm, mode=..., atomicity=..., coverage=...)`; sample `response=entry.output`, `reference=entry.expected_output`.

Flow (`_single_turn_ascore`, verbatim below). Two directions run concurrently via `asyncio.gather`:

- **A ("reference_response_task")** = `decompose_and_verify_claims(reference, response)` -> decompose the _response_ into claims (LLM call, ClaimDecompositionPrompt with `response=<response text>`), then verify them against premise = the _reference_ text (LLM call, NLIStatementPrompt `{context: reference, statements: claims}`). Result: bool array `reference_response`.
- **B ("response_reference_task")** = `decompose_and_verify_claims(response, reference)` -> decompose the _reference_ into claims, verify against premise = the _response_. Result `response_reference`. Skipped (replaced by an empty array) only when `mode == "precision"`.
- The claim-decomposition prompt's `examples` are chosen by `f"{atomicity}_atomicity_{coverage}_coverage"` (four variants; instruction identical) -- all four are rendered in section 6. The NLI prompt is the Faithfulness `NLIStatementPrompt` (same instruction and 2 examples).
- `verify_claims` returns `np.array([bool(verdict) ...])` over the verdict objects returned (empty array if none). The NLI call is made even when the claims list is empty.
- Number of LLM calls: **f1 / recall: 4** (2 decompose + 2 NLI); **precision: 2**. (+ repairs.)

Arithmetic (verbatim):

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert self.llm is not None, "LLM must be set"
        assert reference is not None, "Reference is not set"
        assert response is not None, "Response is not set"

        reference_response_task = self.decompose_and_verify_claims(
            reference, response, callbacks
        )

        if self.mode != "precision":
            response_reference_task = self.decompose_and_verify_claims(
                response, reference, callbacks
            )
        else:
            response_reference_task = self._get_passthrough_value(
                value=np.array([], dtype=bool)
            )

        reference_response, response_reference = await asyncio.gather(
            reference_response_task, response_reference_task
        )

        tp = sum(reference_response)
        fp = sum(~reference_response)
        if self.mode != "precision":
            fn = sum(~response_reference)
        else:
            fn = 0

        if self.mode == "precision":
            score = tp / (tp + fp + 1e-8)
        elif self.mode == "recall":
            score = tp / (tp + fn + 1e-8)
        else:
            score = fbeta_score(tp, fp, fn, self.beta)

        return np.round(score, 2)

def fbeta_score(tp, fp, fn, beta=1.0):
    if tp + fp == 0:
        precision = 0
    else:
        precision = tp / (tp + fp)

    if tp + fn == 0:
        recall = 0
    else:
        recall = tp / (tp + fn)

    if precision == 0 and recall == 0:
        return 0.0

    beta_squared = beta**2
    fbeta = (
        (1 + beta_squared)
        * (precision * recall)
        / ((beta_squared * precision) + recall)
    )

    return fbeta
```

Notes: `tp = sum(reference_response)` (response claims supported by reference), `fp = sum(~reference_response)`, `fn = sum(~response_reference)` (reference claims NOT supported by the response). Note that in `recall` mode the numerator still uses `tp` from direction A.
Final score = `np.round(score, 2)` (numpy round-half-to-even on the scaled float, i.e. `rint(x*100)/100`). f1 with tp=0 -> `fbeta_score` returns 0.0 (precision=recall=0). `precision`/`recall` modes add `1e-8` in the denominator (so all-zero -> 0.0).
The `decompose_claims` / `verify_claims` / `decompose_and_verify_claims` methods are in the source; decomposition and NLI code verbatim:

```python
    async def decompose_claims(
        self, response: str, callbacks: Callbacks
    ) -> t.List[str]:
        assert self.llm is not None, "LLM must be set"

        prompt_input = ClaimDecompositionInput(response=response)
        result = await self.claim_decomposition_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return result.claims

    async def verify_claims(
        self, premise: str, hypothesis_list: t.List[str], callbacks: Callbacks
    ) -> np.ndarray:
        assert self.llm is not None, "LLM must be set"
        prompt_input = NLIStatementInput(context=premise, statements=hypothesis_list)
        response = await self.nli_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        if response.statements:
            claim_verifications = np.array(
                [bool(result.verdict) for result in response.statements]
            )
        else:
            claim_verifications = np.array([], dtype=bool)
        return claim_verifications

    async def decompose_and_verify_claims(
        self, reference: str, response: str, callbacks: Callbacks
    ) -> np.ndarray:
        claims = await self.decompose_claims(response, callbacks)
        return await self.verify_claims(
            premise=reference, hypothesis_list=claims, callbacks=callbacks
        )

    def __post_init__(self):
        value = f"{self.atomicity}_atomicity_{self.coverage}_coverage"

        # This creates a new instance-specific examples list, isolating
        # changes to just this instance and preventing cross-contamination
        # with other metrics.
        self.claim_decomposition_prompt.examples = []

        for item in DecompositionType:
            if item.value == value:
                self.claim_decomposition_prompt.examples.extend(
                    claim_decomposition_examples[item]
                )
        if not self.claim_decomposition_prompt.examples:
            logger.warning(
                f"No examples found for the atomicity and coverage level: {value}"
            )

        if type(self.beta) is not float:
            raise ValueError(
                "Beta must be a float. A beta > 1 gives more weight to recall, while beta < 1 favors precision."
            )
```

Wrapper details format: wraps `verify_claims` and appends each call as `{premise, hypothesis_list, scores}` in COMPLETION order of the two `verify_claims` calls. The first recorded breakdown is printed as `# Precision`, the second (if any) as `# Recall`:
`# Precision\nPremise: {premise}\nHypothesis list:\n` then per verdict `- "{hypothesis}": {True|False}\n`; then `\n# Recall\nPremise: ...` the same way. Because the LLM client is synchronous under an async wrapper the order is effectively A then B, but it is not guaranteed; the labels follow completion order, not direction.
`details` is `None` if empty. If the LLM returns MORE verdicts than claims the wrapper's `hypothesis_list[i]` raises IndexError (the evaluator errors).
`EvaluationResultSkipped("No claims could be generated from output.")` only if `verify_claims` was never called (effectively unreachable).

Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasFactualCorrectnessEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            output=entry.output,
            expected_output=entry.expected_output,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = FactualCorrectness(
            llm=llm,
            mode=self.settings.mode,
            atomicity=self.settings.atomicity,
            coverage=self.settings.coverage,
        )

        _original_verify_claims = scorer.verify_claims

        breakdowns = []

        async def verify_claims(premise: str, hypothesis_list: list[str], callbacks):
            nonlocal breakdowns
            scores = await _original_verify_claims(premise, hypothesis_list, callbacks)
            breakdowns.append(
                {
                    "premise": premise,
                    "hypothesis_list": hypothesis_list,
                    "scores": scores,
                }
            )
            return scores

        scorer.verify_claims = verify_claims

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    reference=entry.expected_output,
                )
            )

        if len(breakdowns) == 0:
            return EvaluationResultSkipped(
                details="No claims could be generated from output.",
            )

        details = ""
        if len(breakdowns) > 0:
            breakdown = breakdowns[0]
            details += (
                f"# Precision\nPremise: {breakdown['premise']}\nHypothesis list:\n"
            )
            for i, score_ in enumerate(breakdown["scores"]):
                details += f"- \"{breakdown['hypothesis_list'][i]}\": {score_}\n"

        if len(breakdowns) > 1:
            breakdown = breakdowns[1]
            details += (
                f"\n# Recall\nPremise: {breakdown['premise']}\nHypothesis list:\n"
            )
            for i, score_ in enumerate(breakdown["scores"]):
                details += f"- \"{breakdown['hypothesis_list'][i]}\": {score_}\n"

        return RagasResult(
            score=score,
            cost=cost,
            details=details if details else None,
        )
```

### 3.3 LLMContextRecall (wrapper `response_context_recall.py` = evaluator "RagasResponseContextRecall"; ragas `metrics/_context_recall.py::LLMContextRecall`)

Entry: `input: str`, `output: str`, `contexts: list[str]`, `expected_output: str`. Settings: `RagasSettings` only. (`context_recall.py` is a different, non-LLM evaluator.)
`check_max_tokens(input, output, expected_output, contexts)` (contexts NOT cleaned of empties here). Sample: `user_input=input, response=output, reference=expected_output, retrieved_contexts=contexts`. NOTE `response` (output) is not used by the metric (required columns: user_input, retrieved_contexts, reference).

Flow: **1 LLM call** `ContextRecallClassificationPrompt` via `generate_multiple(n=1)` (default n) with `QCA{question: user_input, context: "\n".join(retrieved_contexts), answer: reference}` ->
`{classifications: [{statement, reason, attributed:int}]}`. Then `ensembler.from_discrete([classifications_as_dicts], "attributed")`: with a single generation it returns that list unchanged (majority vote code only matters for n>1, unused). Score:

```python
    def _compute_score(self, responses: t.List[ContextRecallClassification]) -> float:
        response = [1 if item.attributed else 0 for item in responses]
        denom = len(response)
        numerator = sum(response)
        score = numerator / denom if denom > 0 else np.nan

        if np.isnan(score):
            logger.warning("The LLM did not return a valid classification.")

        return score

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "set LLM before use"

        # run classification
        classifications_list: t.List[
            ContextRecallClassifications
        ] = await self.context_recall_prompt.generate_multiple(
            data=QCA(
                question=row["user_input"],
                context="\n".join(row["retrieved_contexts"]),
                answer=row["reference"],
            ),
            llm=self.llm,
            callbacks=callbacks,
        )
        classification_dicts = []
        for classification in classifications_list:
            classification_dicts.append(
                [clasif.model_dump() for clasif in classification.classifications]
            )

        ensembled_clasif = ensembler.from_discrete(classification_dicts, "attributed")

        return self._compute_score(
            [ContextRecallClassification(**clasif) for clasif in ensembled_clasif]
        )
```

Empty classification list -> score NaN (NOT skipped by the wrapper; `RagasResult(score=nan)` is returned).
Details: `"\n\n".join(f"Statement: {r.statement}\nReason: {r.reason}\nAttributed: {r.attributed}")` over the classifications (attributed printed as the parsed int); `None` if there are none.

Wrapper source (verbatim):

```python
    def evaluate(
        self, entry: RagasResponseContextRecallEntry
    ) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            expected_output=entry.expected_output,
            contexts=entry.contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = LLMContextRecall(llm=llm)

        _original_compute_score = scorer._compute_score

        breakdown = []

        def _compute_score(responses: list[ContextRecallClassification]) -> float:
            nonlocal breakdown
            breakdown += responses
            return _original_compute_score(responses)

        scorer._compute_score = _compute_score

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                    reference=entry.expected_output,
                    retrieved_contexts=entry.contexts,
                )
            )

        details = None
        if len(breakdown) > 0:
            details = "\n\n".join(
                [
                    f"Statement: {r.statement}\nReason: {r.reason}\nAttributed: {r.attributed}"
                    for r in breakdown
                ]
            )

        return RagasResult(
            score=score,
            cost=cost,
            details=details,
        )
```

### 3.4 ResponseRelevancy (wrapper `response_relevancy.py`, ragas `metrics/_answer_relevance.py::ResponseRelevancy`)

Entry: `input: str`, `output: str`. Settings: `RagasSettings` + `embeddings_model: str = "openai/text-embedding-ada-002"`. `strictness = 3` (not exposed). LLM temperature 0.7 (see section 1).
`prepare_llm` also builds the embeddings: `LangchainEmbeddingsWrapper(LitellmEmbeddingsWrapper(model=embeddings_model, api_key="dummy", client=LitellmEmbeddings(extra_call_kwargs=azure api_version 2024-02-01)))`;
`LitellmEmbeddings.create` calls `litellm.embedding(**kwargs)` and returns `.model_dump()`.
Sample: `user_input=entry.input`, `response=entry.output`. `check_max_tokens(input, output)`.

Flow:

1. **ONE LLM request with `n=3`** (`generate_multiple(n=self.strictness)`), `ResponseRelevancePrompt` with `{response}` -> 3 independent parses of `{question: str, noncommittal: int}` (each choice parsed and repaired independently).
2. `_calculate_score(answers, row)`: `gen_questions = [a.question ...]`; `all_noncommittal = np.all([a.noncommittal ...])` (numpy truthiness of ints: nonzero = true). If ALL generated questions are `""` -> NaN (wrapper then skips: "No questions could be generated from output."). Otherwise
   `cosine_sim = calculate_similarity(question, gen_questions)`; `score = cosine_sim.mean() * int(not all_noncommittal)`.
3. Embedding calls: `embed_query(user_input)` (one call, raw string) and `embed_documents(gen_questions)` (one batched call). Model = `settings.embeddings_model`. (langchain `OpenAIEmbeddings.embed_documents` with the default `check_embedding_ctx_length=True` tokenizes each text with tiktoken, splits into <=8191-token chunks, sends the decoded chunk strings, and length-weighted-averages + L2-normalises chunks per text; for short questions this is one chunk each and equals the plain embedding. `embed_query` is overridden to send the raw text and returns the raw vector.)
   Verbatim:

```python
    def calculate_similarity(self, question: str, generated_questions: list[str]):
        assert self.embeddings is not None, (
            f"Error: '{self.name}' requires embeddings to be set."
        )
        question_vec = np.asarray(self.embeddings.embed_query(question)).reshape(1, -1)  # type: ignore[attr-defined]
        gen_question_vec = np.asarray(
            self.embeddings.embed_documents(generated_questions)  # type: ignore[attr-defined]
        ).reshape(len(generated_questions), -1)
        norm = np.linalg.norm(gen_question_vec, axis=1) * np.linalg.norm(
            question_vec, axis=1
        )
        return (
            np.dot(gen_question_vec, question_vec.T).reshape(
                -1,
            )
            / norm
        )

    def _calculate_score(
        self, answers: t.Sequence[ResponseRelevanceOutput], row: t.Dict
    ) -> float:
        question = row["user_input"]
        gen_questions = [answer.question for answer in answers]
        all_noncommittal = np.all([answer.noncommittal for answer in answers])
        if all(q == "" for q in gen_questions):
            logger.warning(
                "Invalid JSON response. Expected dictionary with key 'question'"
            )
            score = np.nan
        else:
            cosine_sim = self.calculate_similarity(question, gen_questions)
            score = cosine_sim.mean() * int(not all_noncommittal)

        return score

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "LLM is not set"

        prompt_input = ResponseRelevanceInput(response=row["response"])

        responses = await self.question_generation.generate_multiple(
            data=prompt_input, llm=self.llm, callbacks=callbacks, n=self.strictness
        )

        return self._calculate_score(responses, row)
```

Cosine similarity is unclamped (can be negative); zero vectors give NaN. A "noncommittal" verdict zeroes the score only if ALL n answers are noncommittal.
Wrapper details: `Questions generated from output:\n\n- {q1}\n- {q2}\n- {q3}\n\nSimilarity to original question: {breakdown['similarity']}\nEvasive answer: {any_noncommittal}` where
`breakdown["similarity"]` is a NUMPY ARRAY of the 3 cosine values (initial `0 + ndarray`), formatted with numpy's default `str` (e.g. `[0.87421135 0.9012 0.85]`, up to 8 significant digits, space-separated, in brackets), and `any_noncommittal = any(...)` (Python `True`/`False`) -- note this is `any`, whereas the score uses `all`.
Skip: no non-empty generated question -> `EvaluationResultSkipped(details="No questions could be generated from output.")`.

Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasResponseRelevancyEntry) -> SingleEvaluationResult:
        llm, embeddings = prepare_llm(self, self.settings, temperature=0.7)

        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = ResponseRelevancy(llm=llm, embeddings=embeddings)

        _original_calculate_similarity = scorer.calculate_similarity
        _original_calculate_score = scorer._calculate_score

        breakdown = {"similarity": 0, "answers": []}

        def calculate_similarity(question: str, generated_questions):
            nonlocal breakdown
            similarity = _original_calculate_similarity(question, generated_questions)
            breakdown["similarity"] += similarity
            return similarity

        def _calculate_score(answers: Sequence[ResponseRelevanceOutput], row: dict):
            nonlocal breakdown
            breakdown["answers"] += answers
            return _original_calculate_score(answers, row)

        scorer.calculate_similarity = calculate_similarity
        scorer._calculate_score = _calculate_score

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                )
            )

        generated_questions = "\n".join(
            [f"- {answer.question}" for answer in breakdown["answers"]]
        )

        if len([answer for answer in breakdown["answers"] if answer.question]) == 0:
            return EvaluationResultSkipped(
                details="No questions could be generated from output.",
            )

        any_noncommittal = any([answer.noncommittal for answer in breakdown["answers"]])

        return RagasResult(
            score=score,
            cost=cost,
            details=f"Questions generated from output:\n\n{generated_questions}\n\nSimilarity to original question: {breakdown['similarity']}\nEvasive answer: {any_noncommittal}",
        )
```

### 3.5 SummarizationScore (wrapper `summarization_score.py`, ragas `metrics/_summarization.py::SummarizationScore`)

Entry: `output: str`, `contexts: list[str]`. Settings: `RagasSettings` only. Defaults kept: `coeff = 0.5`, `length_penalty = True`, `max_retries = 1`.
Sample: `response=output`, `retrieved_contexts=contexts`, `reference_contexts=contexts` (both set; the metric reads `reference_contexts`). `check_max_tokens(output, contexts)`.

Flow (3 sequential LLM calls; `text = "\n".join(reference_contexts)`, `summary = response`):

1. `ExtractKeyphrasePrompt` input `StringIO{text}` -> `{keyphrases: [str]}`.
2. `GenerateQuestionsPrompt` input `{text, keyphrases}` -> `{questions: [str]}`.
3. `GenerateAnswersPrompt` input `SummaryAndQuestions{summary, questions}` -> `{answers: [str]}` (must be JSON strings "1"/"0"; numbers fail validation and trigger repair).
   Arithmetic (verbatim):

```python
    async def _ascore(self, row: Dict, callbacks: Callbacks) -> float:
        text: str = "\n".join(row["reference_contexts"])
        summary: str = row["response"]
        keyphrases = await self._extract_keyphrases(text, callbacks)
        questions = await self._get_questions(text, keyphrases, callbacks)
        answers = await self._get_answers(questions, summary, callbacks)

        scores = {}
        qa_score = self._compute_qa_score(answers)
        scores["qa_score"] = qa_score
        if self.length_penalty:
            conciseness_score = self._compute_conciseness_score(text, summary)
            scores["conciseness_score"] = conciseness_score
        return self._compute_score(scores)

    def _compute_score(self, scores) -> float:
        return (
            scores["qa_score"] * (1 - self.coeff)
            + scores.get("conciseness_score", 0) * self.coeff
        )

    def _compute_qa_score(self, answers: t.List[str]) -> float:
        correct = sum([1 for a in answers if a.lower() == "1"])
        return correct / len(answers)

    def _compute_conciseness_score(self, text, summary) -> float:
        return 1 - min(len(summary), len(text)) / (len(text) + 1e-10)
```

With defaults: `score = qa_score*0.5 + conciseness_score*0.5`. `len()` is Python character (code point) count -> use rune counts in Go. Verified example: summary "short" (5) vs text "long text here" (14), answers ["1","0"]: `0.5*0.5 + 0.5*(1-5/14) = 0.5714285714298469` (the `1e-10` epsilon is visible).
`qa_score` divides by `len(answers)`: an EMPTY answers list raises `ZeroDivisionError` (evaluator error, no guard). `a.lower() == "1"` is the only "correct" test (so `"1 "` or `"yes"` count as 0). The answers list length is not checked against the question count.
Empty keyphrases/questions are passed through (the LLM is still called). `conciseness = 1 - min(len(summary), len(text)) / (len(text)+1e-10)` is 0 when the summary is at least as long as the text (no negative values).
Wrapper details: `f"QA Score: {qa:.2f}"` and, if present, `"\nConciseness Score: {c:.2f}"`.

Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasSummarizationScoreEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            output=entry.output,
            contexts=entry.contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = SummarizationScore(llm=llm)

        _original_compute_score = scorer._compute_score

        breakdown = {}

        def compute_score(scores):
            nonlocal breakdown
            breakdown = scores
            return _original_compute_score(scores)

        scorer._compute_score = compute_score

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    # TODO: there is a mismatch between docs and actual implementation, docs says retrieved_contexts
                    # but it's reference_contexts, check back in a few months which direction Ragas actually went at
                    # at the end, for now, we'll pass both to avoid breaking changes
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.contexts,
                )
            )

        details = f"QA Score: {breakdown['qa_score']:.2f}"
        if "conciseness_score" in breakdown:
            details += f"\nConciseness Score: {breakdown['conciseness_score']:.2f}"

        return RagasResult(
            score=score,
            cost=cost,
            details=details,
        )
```

### 3.6 InstanceRubrics (wrapper `rubrics_based_scoring.py`, ragas `metrics/_instance_specific_rubrics.py::InstanceRubrics`)

Entry: `input: str`, `output: str`, `expected_output: Optional[str] = None`. Settings: `RagasSettings` + `rubrics: list[{description}]`. Default rubrics (5, in order):

1. "The response is incorrect, irrelevant."
2. "The response partially answers the question but includes significant errors, omissions, or irrelevant information."
3. "The response partially answers the question but includes minor errors, omissions, or irrelevant information."
4. "The response fully answers the question and includes minor errors, omissions, or irrelevant information."
5. "The response fully answers the question and includes no errors, omissions, or irrelevant information."
   Wrapper builds `rubrics = {f"score{i+1}_description": r.description for i, r in enumerate(settings.rubrics)}` (1-based, insertion order preserved in the JSON). `check_max_tokens(input, output, expected_output)`.
   Sample: `user_input=input, response=output, reference=expected_output (None -> omitted), rubrics=rubrics`. `retrieved_contexts` is never set, so the "answer using context" branch is not taken.

Flow: **1 LLM call**, `SingleTurnPrompt` (the one in `_instance_specific_rubrics.py`, input model `SingleTurnInputWithRubric` = `user_input, response, retrieved_contexts, reference_contexts, reference` (all optional, None omitted) + `rubrics: dict[str,str]`), output `ScoreFeedback{feedback: str, score: int}`. **No examples.**
`_ascore` returns `response.score` as is (no validation against the rubric range, no normalisation). Result `RagasResult(score=float(score), cost, details=feedback)`; `passed` is None.
Verbatim:

```python
    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "LLM is not set"

        user_input, contexts, response, reference, rubrics = (
            row.get("user_input"),
            row.get("retrieved_contexts"),
            row.get("response"),
            row.get("reference"),
            row.get("rubrics"),
        )
        if contexts is not None:
            contexts = "\n".join(contexts)
            user_input = f"{user_input} answer using context: {contexts}"

        if rubrics is None:
            raise ValueError(f"Rubrics are not set for the sample: {row}")
        prompt_input = SingleTurnInputWithRubric(
            user_input=user_input,
            response=response,
            reference=reference,
            rubrics=rubrics,
        )

        response = await self.single_turn_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return response.score
```

Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasRubricsBasedScoringEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            expected_output=entry.expected_output,
            settings=self.settings,
        )
        if skip:
            return skip

        rubrics = {
            f"score{i + 1}_description": r.description
            for i, r in enumerate(self.settings.rubrics)
        }
        scorer = InstanceRubrics(llm=llm)

        _original_generate = scorer.single_turn_prompt.generate

        breakdown = None

        async def generate(*args, **kwargs):
            nonlocal breakdown
            result = await _original_generate(*args, **kwargs)
            breakdown = result
            return result

        scorer.single_turn_prompt.generate = generate

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                    reference=entry.expected_output,
                    rubrics=rubrics,
                )
            )

        return RagasResult(
            score=score,
            cost=cost,
            details=breakdown.feedback if breakdown else None,
        )
```

### 3.7 LLMSQLEquivalence (wrapper `sql_query_equivalence.py`, ragas `metrics/_sql_semantic_equivalence.py`)

Entry: `output: str` (response SQL), `expected_output: str` (reference SQL), `expected_contexts: list[str]` (schemas). Settings: `RagasSettings`.
`check_max_tokens(output, expected_output, contexts=expected_contexts)`. Sample: `response=output, reference=expected_output, reference_contexts=expected_contexts`.
Flow: **1 LLM call** `EquivalencePrompt` with `EquivalenceInput{reference, response, database_schema="\n".join(reference_contexts)}` -> `EquivalenceOutput{response_query_explaination: str, reference_query_explaination: str, equivalence: bool}` (sic: "explaination").
Score: `int(response.equivalence)` (0/1). Wrapper result: `RagasSQLQueryEquivalenceResult(passed=score >= 0.5, cost, details=...)` -- **no `score` field is set** (only `passed`); details:
`Response query explaination: {response_query_explaination}\nReference query explaination: {reference_query_explaination}\nEquivalence: {True|False}` (Python bool repr); `None` if the LLM call never produced a result.
Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasSQLQueryEquivalenceEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        # The scorer reads the expected contexts as the table schemas it
        # compares the two queries against, so they count towards the payload.
        skip = check_max_tokens(
            output=entry.output,
            expected_output=entry.expected_output,
            contexts=entry.expected_contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = LLMSQLEquivalence(llm=llm)

        _original_generate = scorer.equivalence_prompt.generate

        breakdown = None

        async def generate(*args, **kwargs):
            nonlocal breakdown
            result = await _original_generate(*args, **kwargs)
            breakdown = result
            return result

        scorer.equivalence_prompt.generate = generate

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    reference=entry.expected_output,
                    reference_contexts=entry.expected_contexts,
                )
            )

        return RagasSQLQueryEquivalenceResult(
            passed=score >= 0.5,
            cost=cost,
            details=(
                f"Response query explaination: {breakdown.response_query_explaination}\nReference query explaination: {breakdown.reference_query_explaination}\nEquivalence: {breakdown.equivalence}"
                if breakdown
                else None
            ),
        )
```

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        assert self.llm is not None, "LLM is not initialized"
        assert isinstance(sample.reference, str), "Sample reference must be a string"
        assert isinstance(sample.response, str), "Sample response must be a string"
        assert isinstance(sample.reference_contexts, list), (
            "Sample reference_contexts must be a List"
        )

        database_schema = "\n".join(sample.reference_contexts)
        input_data = EquivalenceInput(
            reference=sample.reference,
            response=sample.response,
            database_schema=database_schema,
        )
        response = await self.equivalence_prompt.generate(
            data=input_data, llm=self.llm, callbacks=callbacks
        )
        return int(response.equivalence)
```

### 3.8 response_context_precision (wrapper `response_context_precision.py`; ragas `metrics/_context_precision.py::LLMContextPrecisionWithReference` / `LLMContextPrecisionWithoutReference`)

Entry: `input: str`, `output: Optional[str] = None`, `contexts: list[str]`, `expected_output: Optional[str] = None`. Settings: `RagasSettings` only (`model`, `max_tokens`).

Which scorer the wrapper picks (verbatim logic below):

1. If neither `output` nor `expected_output` is truthy (None or empty string) -> `EvaluationResultSkipped(details="Either output or expected_output must be provided.")` BEFORE any LLM setup or token check.
2. `check_max_tokens(input=input, output=None if expected_output else output, expected_output=expected_output, contexts=contexts)`; only the field that will be scored is counted (output is ignored when `expected_output` is truthy); each context counted separately, empty strings NOT dropped. Over the limit -> skip `Total tokens exceed the maximum of {limit}: {total}`.
3. `if entry.expected_output:` (truthy) -> `LLMContextPrecisionWithReference`, sample `user_input=input, reference=expected_output, retrieved_contexts=contexts` (the `output` is not passed at all). Otherwise -> `LLMContextPrecisionWithoutReference`, sample `user_input=input, response=output, retrieved_contexts=contexts`. So expected_output wins whenever both are present.
4. Result `RagasResult(score=score, cost=cost, details=None)` (no details, `passed` None).

Both ragas classes share ONE prompt (`ContextPrecisionPrompt`, rendered in section 6) and the same code; they differ only in which field is fed as `answer`
(`reference` vs `response`; `_get_row_attributes`) and the required columns.

Flow (`_ascore`): for EACH retrieved context, IN ORDER and sequentially (an `await` inside a `for` loop, no concurrency):
**one LLM call** `ContextPrecisionPrompt` with `QAC{question: user_input, context: <this single context>, answer: <reference or response>}` -> `Verification{reason: str, verdict: int}`.
`generate_multiple` with default `n=1`; `ensembler.from_discrete([response], "verdict")` with a single generation returns it unchanged. So the number of LLM calls = `len(contexts)` (+ repairs; 0 calls if `contexts` is empty).
Each call: temperature 0.01 (0 configured), `n=1`, one user message, same transport as section 1.

Score = average precision over the ranked list of verdicts (verbatim; note the `1e-10` epsilon, so a perfect score is `0.9999999999` and NOT 1.0 for one relevant context; e.g. verdicts [1,0,1] -> `0.8333333332916666`, [0,1,1] -> `0.5833333333041666`, [1] -> `0.9999999999`, all zeros -> `0.0`):

```python
    def _calculate_average_precision(
        self, verifications: t.List[Verification]
    ) -> float:
        score = np.nan

        verdict_list = [1 if ver.verdict else 0 for ver in verifications]
        denominator = sum(verdict_list) + 1e-10
        numerator = sum(
            [
                (sum(verdict_list[: i + 1]) / (i + 1)) * verdict_list[i]
                for i in range(len(verdict_list))
            ]
        )
        score = numerator / denominator
        if np.isnan(score):
            logger.warning(
                "Invalid response format. Expected a list of dictionaries with keys 'verdict'"
            )
        return score

    async def _ascore(
        self,
        row: t.Dict,
        callbacks: Callbacks,
    ) -> float:
        assert self.llm is not None, "LLM is not set"

        user_input, retrieved_contexts, reference = self._get_row_attributes(row)
        responses = []
        for context in retrieved_contexts:
            verdicts: t.List[
                Verification
            ] = await self.context_precision_prompt.generate_multiple(
                data=QAC(
                    question=user_input,
                    context=context,
                    answer=reference,
                ),
                llm=self.llm,
                callbacks=callbacks,
            )

            responses.append([result.model_dump() for result in verdicts])

        answers = []
        for response in responses:
            agg_answer = ensembler.from_discrete([response], "verdict")
            answers.append(Verification(**agg_answer[0]))

        score = self._calculate_average_precision(answers)
        return score

    def _get_row_attributes(self, row: t.Dict) -> t.Tuple[str, t.List[str], t.Any]:
        return row["user_input"], row["retrieved_contexts"], row["reference"]

    def _get_row_attributes(self, row: t.Dict) -> t.Tuple[str, t.List[str], t.Any]:
        return row["user_input"], row["retrieved_contexts"], row["response"]
```

`verdict` is an `int` truthiness test (`1 if ver.verdict else 0`; `"1"`, `1.0` and `true` parse to 1 via pydantic lax mode). Formula: with `v_i in {0,1}` for context i (1-based rank k):
`score = ( sum_{i=1..k} v_i * (sum_{j<=i} v_j) / i ) / ( sum_i v_i + 1e-10 )`.
NaN/empty handling: empty `contexts` -> no calls, `numerator = 0`, `denominator = 1e-10` -> score `0.0` (NOT NaN, NOT skipped); all verdicts 0 -> `0.0`. `np.isnan` is checked only for a warning (unreachable). If a call fails after repairs the whole evaluation errors (nothing partial).
Order matters (rank-aware): the contexts are scored in the order supplied.

Wrapper source (verbatim):

```python
    def evaluate(
        self, entry: RagasResponseContextPrecisionEntry
    ) -> SingleEvaluationResult:
        if not entry.output and not entry.expected_output:
            return EvaluationResultSkipped(
                details="Either output or expected_output must be provided.",
            )

        llm, _ = prepare_llm(self, self.settings)

        # Both scorers below read the question and the retrieved contexts, and
        # the contexts are the bulk of a RAG payload, so the guard has to count
        # them. Which of output and expected_output is scored depends on the
        # same condition the scorer is picked by.
        skip = check_max_tokens(
            input=entry.input,
            output=None if entry.expected_output else entry.output,
            expected_output=entry.expected_output,
            contexts=entry.contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        if entry.expected_output:
            scorer = LLMContextPrecisionWithReference(llm=llm)

            with capture_cost(llm) as cost:
                score = scorer.single_turn_score(
                    SingleTurnSample(
                        user_input=entry.input,
                        reference=entry.expected_output,
                        retrieved_contexts=entry.contexts,
                    )
                )
        else:
            scorer = LLMContextPrecisionWithoutReference(llm=llm)
            with capture_cost(llm) as cost:
                score = scorer.single_turn_score(
                    SingleTurnSample(
                        user_input=entry.input,
                        response=entry.output,
                        retrieved_contexts=entry.contexts,
                    )
                )

        return RagasResult(
            score=score,
            cost=cost,
            details=None,
        )
```

## 4. Non-LLM metrics (no LLM, no cost, no token check, no skip)

None of these evaluators calls `check_max_tokens` or an LLM; results have `cost=None`; nothing is ever token-skipped (they can still be "perfect/zero by rule", see each wrapper).

### 4.1 Shared: rapidfuzz string similarity (ragas `metrics/_string.py`)

`DistanceMeasure` enum values and the mapping to rapidfuzz classes (verbatim):

```python
# ragas/metrics/_string.py
class DistanceMeasure(Enum):
    LEVENSHTEIN = "levenshtein"
    HAMMING = "hamming"
    JARO = "jaro"
    JARO_WINKLER = "jaro_winkler"

# NonLLMStringSimilarity.__post_init__
    def __post_init__(self):
        try:
            from rapidfuzz import distance
        except ImportError:
            raise ImportError(
                "rapidfuzz is required for string distance. Please install it using `pip install rapidfuzz`"
            )

        self.distance_measure_map = {
            DistanceMeasure.LEVENSHTEIN: distance.Levenshtein,
            DistanceMeasure.HAMMING: distance.Hamming,
            DistanceMeasure.JARO: distance.Jaro,
            DistanceMeasure.JARO_WINKLER: distance.JaroWinkler,
        }

# NonLLMStringSimilarity._single_turn_ascore
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert isinstance(reference, str), "Expecting a string"
        assert isinstance(response, str), "Expecting a string"
        return 1 - self.distance_measure_map[self.distance_measure].normalized_distance(
            reference, response
        )
```

So the pairwise similarity used everywhere is
`similarity(reference, response) = 1 - rapidfuzz.distance.<Levenshtein|Hamming|Jaro|JaroWinkler>.normalized_distance(reference, response)` with ALL rapidfuzz defaults
(rapidfuzz 3.14.5: `processor=None` -> no lowercasing/trimming/normalisation, `score_cutoff=None`; Levenshtein `weights=(1,1,1)`; Hamming `pad=True`; JaroWinkler `prefix_weight=0.1`).
Inputs are Python `str` -> sequences of Unicode CODE POINTS (use `[]rune` in Go; bytes or grapheme clusters would give different numbers for non-ASCII).
Because the metrics call it through `single_turn_ascore(SingleTurnSample(reference=<retrieved ctx>, response=<expected ctx>))`, the first argument is the RETRIEVED context and the second the EXPECTED one (all four measures are symmetric, so the order does not change the value).
Semantics (all verified below to 1.2e-16 absolute against rapidfuzz):

- **Levenshtein**: unit-cost insert/delete/substitute edit distance divided by `max(len(a), len(b))`; both empty -> distance 0.0 (similarity 1.0).
- **Hamming** (`pad=True`): count of positions in the common prefix length where the runes differ PLUS the length difference, divided by `max(len)`; both empty -> 0.0.
- **Jaro**: classic Jaro similarity; both empty -> similarity 1.0; exactly one empty -> 0.0. Match window `max(len)//2 - 1` (floored at 0) around each index of the SHORTER string P against the longer T, greedy left-to-right first unmatched equal rune; `t = (number of position mismatches among the matched runes in order) // 2` (INTEGER floor division, this matters); `sim = (m/|P| + m/|T| + (m - t)/m) / 3`, 0 if `m == 0`. `normalized_distance = 1 - sim`.
- **JaroWinkler**: `s = jaro`; if `s > 0.7` (strictly) then `s += prefix * 0.1 * (1 - s)` where `prefix` = length of the common prefix of the two strings, capped at 4; `normalized_distance = 1 - s`.
  Empty strings: `similarity("", "") = 1.0` for all four; `similarity("a", "") = 0.0`. An empty-string context therefore matches an empty-string expected context perfectly.

Pure-Python reference (**verified**: rapidfuzz functions vs this code over ~140,000 random pairs incl. unicode and lengths up to 400 -> max abs diff 1.1e-16; the two metric functions below vs the real ragas `NonLLMContextPrecisionWithReference` / `NonLLMContextRecall` over 1,600 random context sets x 4 measures -> max abs diff 0.0). Port this line by line, comparing with a tolerance of 1e-9 or exactly with the same float operation order:

```python
# Pure-Python reference of the rapidfuzz functions ragas uses (rapidfuzz 3.14.5) and of the two
# NonLLM metrics. Strings are Python str, i.e. sequences of Unicode code points (runes in Go);
# no preprocessing (no lowercasing, no trimming).
def lev_dist(a, b):                      # Levenshtein, weights (ins=1, del=1, sub=1)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def lev_norm(a, b):                      # Levenshtein.normalized_distance
    m = max(len(a), len(b))
    return lev_dist(a, b) / m if m else 0.0

def ham_norm(a, b):                      # Hamming.normalized_distance (pad=True: length gap counts as mismatches)
    m = max(len(a), len(b))
    if not m:
        return 0.0
    return (sum(1 for x, y in zip(a, b) if x != y) + abs(len(a) - len(b))) / m

def jaro_sim(a, b):                      # Jaro.similarity (Jaro.normalized_distance = 1 - this)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    if len(a) > len(b):                  # P = shorter, T = longer; matching is greedy left to right
        a, b = b, a
    bound = max(len(b) // 2 - 1, 0)
    pm, tm, m = [False] * len(a), [False] * len(b), 0
    for i, ca in enumerate(a):
        for j in range(max(0, i - bound), min(len(b), i + bound + 1)):
            if not tm[j] and b[j] == ca:
                pm[i] = tm[j] = True
                m += 1
                break
    if m == 0:
        return 0.0
    t, j = 0, 0
    for i in range(len(a)):
        if pm[i]:
            while not tm[j]:
                j += 1
            if a[i] != b[j]:
                t += 1
            j += 1
    t //= 2                              # INTEGER (floor) division, as rapidfuzz does
    return (m / len(a) + m / len(b) + (m - t) / m) / 3

def jw_sim(a, b, prefix_weight=0.1):     # JaroWinkler.similarity
    s = jaro_sim(a, b)
    if s > 0.7:                          # strictly greater
        p = 0
        for x, y in zip(a[:4], b[:4]):   # common prefix, capped at 4
            if x != y:
                break
            p += 1
        s += p * prefix_weight * (1 - s)
    return s

SIMILARITY = {                           # NonLLMStringSimilarity: 1 - normalized_distance(reference, response)
    "levenshtein": lambda a, b: 1 - lev_norm(a, b),
    "hamming": lambda a, b: 1 - ham_norm(a, b),
    "jaro": jaro_sim,
    "jaro_winkler": jw_sim,
}

def context_precision(retrieved, expected, measure):   # NonLLMContextPrecisionWithReference
    sim = SIMILARITY[measure]
    v = [1 if max(sim(rc, ref) for ref in expected) >= 0.5 else 0 for rc in retrieved]   # >= 0.5
    den = sum(v) + 1e-10
    num = sum((sum(v[: i + 1]) / (i + 1)) * v[i] for i in range(len(v)))
    return num / den

def context_recall(retrieved, expected, measure):      # NonLLMContextRecall
    sim = SIMILARITY[measure]
    v = [1 if max(sim(rc, ref) for rc in retrieved) > 0.5 else 0 for ref in expected]    # strictly > 0.5
    return sum(v) / len(v) if v else float("nan")
```

Worked values for Go golden tests (computed with rapidfuzz 3.14.5): `similarity("abc","abd")`: levenshtein 0.666667, hamming 0.666667, jaro 0.777778, jaro_winkler 0.822222; `similarity("Paris is the capital of France.", "Paris is the capital of France.")` = 1.0;
`similarity("The Eiffel Tower is in Paris.", "The Eiffel Tower is located in Paris.")`: levenshtein 0.783784, hamming 0.540541, jaro 0.904939, jaro_winkler 0.942964.

### 4.2 ragas/context_precision (wrapper `context_precision.py`; ragas `metrics/_context_precision.py::NonLLMContextPrecisionWithReference`)

Entry: `contexts: list[str]` (retrieved), `expected_contexts: list[str]`. Settings: `distance_measure` in {levenshtein (default), hamming, jaro, jaro_winkler}. No LLM, no `RagasSettings`, no token check.
Wrapper rules, checked in this order (score and `details` string exact):

1. `expected_contexts` empty AND `contexts` empty -> score `1.0`, details `No contexts retrieved, but also no contexts expected, so that's a perfect precision of 1`.
2. `expected_contexts` empty (contexts non-empty) -> score `0.0`, details `No contexts expected, yet some were retrieved, precision is 0`.
3. `contexts` empty (expected non-empty) -> score `0.0`, details `No contexts retrieved, precision is 0`.
4. Otherwise `NonLLMContextPrecisionWithReference(distance_measure=NonLLMStringSimilarity(distance_measure=<mapped enum>))`, sample `retrieved_contexts=contexts, reference_contexts=expected_contexts`; result `RagasResult(score=score, cost=None, details=None)`.
   Metric arithmetic (verbatim). For each retrieved context (in order): best similarity against any expected context; verdict = 1 if `best >= threshold` (**threshold 0.5, `>=`, inclusive**), else 0; then average precision exactly as in 3.8 (same `1e-10` epsilon, so one perfect hit is `0.9999999999`, and e.g. verdicts [1,0,1] -> `0.8333333332916666`):

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        retrieved_contexts = sample.retrieved_contexts
        reference_contexts = sample.reference_contexts
        assert retrieved_contexts is not None, "retrieved_contexts is empty"
        assert reference_contexts is not None, "reference_contexts is empty"

        scores = []
        for rc in retrieved_contexts:
            scores.append(
                max(
                    [
                        await self.distance_measure.single_turn_ascore(
                            SingleTurnSample(reference=rc, response=ref), callbacks
                        )
                        for ref in reference_contexts
                    ]
                )
            )
        scores = [1 if score >= self.threshold else 0 for score in scores]
        return self._calculate_average_precision(scores)

    def _calculate_average_precision(self, verdict_list: t.List[int]) -> float:
        score = np.nan

        denominator = sum(verdict_list) + 1e-10
        numerator = sum(
            [
                (sum(verdict_list[: i + 1]) / (i + 1)) * verdict_list[i]
                for i in range(len(verdict_list))
            ]
        )
        score = numerator / denominator
        return score
```

All-zero verdicts -> `0/1e-10 = 0.0`. Empty strings inside the lists are NOT filtered (an empty retrieved context scores similarity 0 against a non-empty expected one, 1.0 against an empty one). Contexts are ranked (order matters); duplicates count separately.
Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasContextPrecisionEntry) -> SingleEvaluationResult:
        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            return RagasResult(
                score=1.0,
                cost=None,
                details="No contexts retrieved, but also no contexts expected, so that's a perfect precision of 1",
            )
        if len(entry.expected_contexts) == 0:
            return RagasResult(
                score=0.0,
                cost=None,
                details="No contexts expected, yet some were retrieved, precision is 0",
            )
        if len(entry.contexts) == 0:
            return RagasResult(
                score=0.0,
                cost=None,
                details="No contexts retrieved, precision is 0",
            )
        scorer = NonLLMContextPrecisionWithReference(
            distance_measure=NonLLMStringSimilarity(
                distance_measure={
                    "levenshtein": DistanceMeasure.LEVENSHTEIN,
                    "hamming": DistanceMeasure.HAMMING,
                    "jaro": DistanceMeasure.JARO,
                    "jaro_winkler": DistanceMeasure.JARO_WINKLER,
                }[self.settings.distance_measure]
            )
        )

        score = scorer.single_turn_score(
            SingleTurnSample(
                retrieved_contexts=entry.contexts,
                reference_contexts=entry.expected_contexts,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )
```

### 4.3 ragas/context_recall (wrapper `context_recall.py`; ragas `metrics/_context_recall.py::NonLLMContextRecall`)

Confirmed: the `ragas/context_recall` catalogue evaluator is the NON-LLM recall; the LLM recall is `ragas/response_context_recall` (3.3). Entry/settings as 4.2 (`contexts`, `expected_contexts`, `distance_measure` default levenshtein).
Wrapper rules, in order:

1. both lists empty -> score `1.0`, details `No contexts retrieved, but also no contexts expected, so that's a perfect recall of 1`.
2. `expected_contexts` empty -> score `1.0`, details `No contexts expected, meaning nothing was missing, so that's a perfect recall of 1`.
3. `contexts` empty -> score `0.0`, details `No contexts retrieved, recall is 0`.
4. Otherwise `scorer = NonLLMContextRecall(); scorer.distance_measure = <mapped enum>` (the property setter builds `NonLLMStringSimilarity(distance_measure=...)`), same sample as 4.2; `RagasResult(score=score, cost=None, details=None)`.
   Metric arithmetic (verbatim). Direction is the reverse of precision: for each EXPECTED context, the best similarity over all retrieved contexts; verdict = 1 if `best > 0.5` (**STRICTLY greater**, unlike precision's `>=`); score = mean of the verdicts:

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        retrieved_contexts = sample.retrieved_contexts
        reference_contexts = sample.reference_contexts
        assert retrieved_contexts is not None, "retrieved_contexts is empty"
        assert reference_contexts is not None, "reference_contexts is empty"

        scores = []
        for ref in reference_contexts:
            scores.append(
                max(
                    [
                        await self.distance_measure.single_turn_ascore(
                            SingleTurnSample(reference=rc, response=ref), callbacks
                        )
                        for rc in retrieved_contexts
                    ]
                )
            )
        return self._compute_score(scores)

    def _compute_score(self, verdict_list: t.List[float]) -> float:
        response = [1 if score > self.threshold else 0 for score in verdict_list]
        denom = len(response)
        numerator = sum(response)
        score = numerator / denom if denom > 0 else np.nan
        return score

    @distance_measure.setter
    def distance_measure(self, distance_measure: DistanceMeasure) -> None:
        self._distance_measure = NonLLMStringSimilarity(
            distance_measure=distance_measure
        )
```

No epsilon here: score = hits / len(expected_contexts), exactly (e.g. 2/3 = `0.6666666666666666`). Order-insensitive. NaN only for an empty expected list, which the wrapper handles before calling ragas (rule 2). Note the threshold asymmetry: a pair scoring exactly 0.5 counts as relevant for precision but NOT for recall.
Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasContextRecallEntry) -> SingleEvaluationResult:
        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            return RagasResult(
                score=1.0,
                cost=None,
                details="No contexts retrieved, but also no contexts expected, so that's a perfect recall of 1",
            )
        if len(entry.expected_contexts) == 0:
            return RagasResult(
                score=1.0,
                cost=None,
                details="No contexts expected, meaning nothing was missing, so that's a perfect recall of 1",
            )
        if len(entry.contexts) == 0:
            return RagasResult(
                score=0.0,
                cost=None,
                details="No contexts retrieved, recall is 0",
            )

        scorer = NonLLMContextRecall()
        scorer.distance_measure = {
            "levenshtein": DistanceMeasure.LEVENSHTEIN,
            "hamming": DistanceMeasure.HAMMING,
            "jaro": DistanceMeasure.JARO,
            "jaro_winkler": DistanceMeasure.JARO_WINKLER,
        }[self.settings.distance_measure]

        score = scorer.single_turn_score(
            SingleTurnSample(
                retrieved_contexts=entry.contexts,
                reference_contexts=entry.expected_contexts,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )
```

### 4.4 ragas/context_f1 (wrapper `context_f1.py`)

Entry/settings as 4.2 (`contexts`, `expected_contexts`, `distance_measure` default levenshtein). Uses the SAME two metrics as 4.2 and 4.3 with the SAME `distance_measure`, but with its own empty-list rules:

- precision: both empty -> `1.0`; exactly one empty -> `0.0`; else `NonLLMContextPrecisionWithReference` score (4.2, includes the `1e-10` epsilon).
- recall: both empty -> `1.0`; expected empty -> `1.0`; contexts empty -> `0.0`; else `NonLLMContextRecall` score (4.3).
- `f1 = 2 * (p * r) / (p + r)` if `p + r != 0` else `0` (plain harmonic mean; computed from the UNROUNDED p and r, so e.g. p=0.8333333332916666, r=0.6666666666666666 -> `0.7407407407242798`; p=0.9999999999666667, r=0.6666666666666666 -> `0.7999999999893334`).
- Result `RagasResult(score=f1, cost=None, details=f"Precision: {precision_score}, Recall: {recall_score}")`. The details use Python's default float formatting (shortest round-trip repr: `1.0`, `0.0`, `0.8333333332916666`, `1e-05` style exponents for tiny values; NOT Go's `%v`), so emit shortest-repr floats with a trailing `.0` for whole numbers.
  Note context_f1 has no "No contexts..." message details (unlike 4.2/4.3): details is always the Precision/Recall string.
  Wrapper source (verbatim):

```python
    def evaluate(self, entry: RagasContextF1Entry) -> SingleEvaluationResult:
        precision_scorer = NonLLMContextPrecisionWithReference(
            distance_measure=NonLLMStringSimilarity(
                distance_measure={
                    "levenshtein": DistanceMeasure.LEVENSHTEIN,
                    "hamming": DistanceMeasure.HAMMING,
                    "jaro": DistanceMeasure.JARO,
                    "jaro_winkler": DistanceMeasure.JARO_WINKLER,
                }[self.settings.distance_measure]
            )
        )

        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            precision_score = 1.0
        elif len(entry.expected_contexts) == 0 or len(entry.contexts) == 0:
            precision_score = 0.0
        else:
            precision_score = precision_scorer.single_turn_score(
                SingleTurnSample(
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.expected_contexts,
                )
            )

        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            recall_score = 1.0
        elif len(entry.expected_contexts) == 0:
            recall_score = 1.0
        elif len(entry.contexts) == 0:
            recall_score = 0.0
        else:
            recall_scorer = NonLLMContextRecall()
            recall_scorer.distance_measure = {
                "levenshtein": DistanceMeasure.LEVENSHTEIN,
                "hamming": DistanceMeasure.HAMMING,
                "jaro": DistanceMeasure.JARO,
                "jaro_winkler": DistanceMeasure.JARO_WINKLER,
            }[self.settings.distance_measure]

            recall_score = recall_scorer.single_turn_score(
                SingleTurnSample(
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.expected_contexts,
                )
            )

        f1_score = (
            2 * (precision_score * recall_score) / (precision_score + recall_score)
            if (precision_score + recall_score) != 0
            else 0
        )

        return RagasResult(
            score=f1_score,
            cost=None,
            details=f"Precision: {precision_score}, Recall: {recall_score}",
        )
```

### 4.5 BleuScore (ragas `metrics/_bleu_score.py`; wrapper `bleu_score.py`)

Wrapper: `BleuScore()` (no kwargs), sample `response=entry.output`, `reference=entry.expected_output`; `RagasResult(score=score, cost=None, details=None)`. No settings.
ragas code (verbatim):

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference, response = sample.reference, sample.response
        assert isinstance(reference, str), "BleuScore expects a valid reference string"
        assert isinstance(response, str), "BleuScore expects a valid response string"

        reference_sentences = reference.split(". ")
        response_sentences = response.split(". ")

        reference = [[reference] for reference in reference_sentences]
        response = response_sentences
        score = self.corpus_bleu(response, reference, **self.kwargs).score / 100
        assert isinstance(score, float), "Expecting a float"
        return score
```

So: `reference_sentences = reference.split(". ")` (split on the exact 2-char string ". "), `response_sentences = response.split(". ")`;
`references = [[s] for s in reference_sentences]` (i.e. N reference _streams_ of one segment each, N = number of reference sentences); `hypotheses = response_sentences` (M strings).
Call: `sacrebleu.corpus_bleu(hypotheses, references)` (sacrebleu 2.6.0 `compat.corpus_bleu`) with all defaults: `smooth_method='exp'`, `smooth_value=None`, `force=False`, `lowercase=False`, `tokenize='13a'`, `use_effective_order=False` (=> `BLEU(effective_order=False, max_ngram_order=4)`); result `.score / 100`.

**IMPORTANT parity quirk (verified empirically):** sacrebleu transposes the reference streams (`zip(*references)`) and `zip`s them with the hypotheses (`zip(hypotheses, ref_cache)`), so with `references=[[r1],[r2],...,[rN]]` there is exactly ONE reference segment holding N alternative references `(r1..rN)`, and only the FIRST hypothesis (`response_sentences[0]`) is scored, against ALL reference sentences as multiple references. Everything after the first ". " in the response is ignored. Multi-ref semantics: n-gram clip counts use the per-ngram MAX over references; reference length is the closest to hypothesis length (ties -> shorter).
Examples (verified): response "The cat sat on the mat. It was nice" vs reference "The cat sat on the mat" -> 1.0000000000000004; "the cat is on the mat" vs "a cat is on the mat" -> 0.7598356856515926; empty response -> 0.0; case matters ("hello there" vs "Hello there" -> 0.0).
No length assertion is raised. `assert isinstance(score, float)` holds. Results carry float noise (e.g. 1.0000000000000004) since 100*exp(sum(log 100)/4)/100; do not clamp unless matching that is not needed.

sacrebleu algorithm actually executed (with defaults), for the Go port:

- `_preprocess_segment(sent)`: (lowercase off) `tokenizer(sent.rstrip())`.
- 13a tokenizer (`sacrebleu/tokenizers/tokenizer_13a.py` + `tokenizer_re.py`):

```python
    def __call__(self, line):
        """Tokenizes an input line using a relatively minimal tokenization
        that is however equivalent to mteval-v13a, used by WMT.

        :param line: a segment to tokenize
        :return: the tokenized line
        """

        # language-independent part:
        line = line.replace('<skipped>', '')
        line = line.replace('-\n', '')
        line = line.replace('\n', ' ')

        if '&' in line:
            line = line.replace('&quot;', '"')
            line = line.replace('&amp;', '&')
            line = line.replace('&lt;', '<')
            line = line.replace('&gt;', '>')

        return self._post_tokenizer(f' {line} ')

    def __init__(self):
        self._re = [
            # language-dependent part (assuming Western languages)
            (re.compile(r'([\{-\~\[-\` -\&\(-\+\:-\@\/])'), r' \1 '),
            # tokenize period and comma unless preceded by a digit
            (re.compile(r'([^0-9])([\.,])'), r'\1 \2 '),
            # tokenize period and comma unless followed by a digit
            (re.compile(r'([\.,])([^0-9])'), r' \1 \2'),
            # tokenize dash when preceded by a digit
            (re.compile(r'([0-9])(-)'), r'\1 \2 '),
            # one space only between words
            # NOTE: Doing this in Python (below) is faster
            # (re.compile(r'\s+'), r' '),
        ]

    def __call__(self, line):
        """Common post-processing tokenizer for `13a` and `zh` tokenizers.

        :param line: a segment to tokenize
        :return: the tokenized line
        """
        for (_re, repl) in self._re:
            line = _re.sub(repl, line)

        # no leading or trailing spaces, single space within words
        return ' '.join(line.split())
```

The regex character classes in the first rule are: `{`-`~`, `[`-`` ` ``, space-`&`, `(`-`+`, `:`-`@`, `/` (ASCII ranges, so each such punctuation char is surrounded by spaces). Final `' '.join(line.split())` collapses Unicode whitespace.

- n-grams: `line.split()` tokens, all orders 1..4 (`extract_all_word_ngrams`), reference n-gram counts merged across references by MAX.
- Segment stats (`_compute_segment_statistics`) and final formula (`compute_bleu`), verbatim:

```python
def extract_all_word_ngrams(line: str, min_order: int, max_order: int) -> Tuple[Counter, int]:
    """Extracts all ngrams (min_order <= n <= max_order) from a sentence.

    :param line: A string sentence.
    :param min_order: Minimum n-gram order.
    :param max_order: Maximum n-gram order.
    :return: a Counter object with n-grams counts and the sequence length.
    """

    ngrams = []
    tokens = line.split()

    for n in range(min_order, max_order + 1):
        for i in range(0, len(tokens) - n + 1):
            ngrams.append(tuple(tokens[i: i + n]))

    return Counter(ngrams), len(tokens)

    def _get_closest_ref_len(self, hyp_len: int, ref_lens: List[int]) -> int:
        """Given a hypothesis length and a list of reference lengths, returns
        the closest reference length to be used by BLEU.

        :param hyp_len: The hypothesis length.
        :param ref_lens: A list of reference lengths.
        :return: The closest reference length.
        """
        closest_diff, closest_len = -1, -1

        for ref_len in ref_lens:
            diff = abs(hyp_len - ref_len)
            if closest_diff == -1 or diff < closest_diff:
                closest_diff = diff
                closest_len = ref_len
            elif diff == closest_diff and ref_len < closest_len:
                closest_len = ref_len

        return closest_len

    def _compute_segment_statistics(self, hypothesis: str,
                                    ref_kwargs: Dict) -> List[int]:
        """Given a (pre-processed) hypothesis sentence and already computed
        reference n-grams & lengths, returns the best match statistics across the
        references.

        :param hypothesis: Hypothesis sentence.
        :param ref_kwargs: A dictionary with `refs_ngrams`and `ref_lens` keys
        that denote the counter containing all n-gram counts and reference lengths,
        respectively.
        :return: A list of integers with match statistics.
        """

        ref_ngrams, ref_lens = ref_kwargs['ref_ngrams'], ref_kwargs['ref_lens']

        # Extract n-grams for the hypothesis
        hyp_ngrams, hyp_len = extract_all_word_ngrams(
            hypothesis, 1, self.max_ngram_order)

        ref_len = self._get_closest_ref_len(hyp_len, ref_lens)

        # Count the stats
        # Although counter has its internal & and | operators, this is faster
        correct = [0 for i in range(self.max_ngram_order)]
        total = correct[:]
        for hyp_ngram, hyp_count in hyp_ngrams.items():
            # n-gram order
            n = len(hyp_ngram) - 1
            # count hypothesis n-grams
            total[n] += hyp_count
            # count matched n-grams
            if hyp_ngram in ref_ngrams:
                correct[n] += min(hyp_count, ref_ngrams[hyp_ngram])

        # Return a flattened list for efficient computation
        return [hyp_len, ref_len] + correct + total

    @staticmethod
    def compute_bleu(correct: List[int],
                     total: List[int],
                     sys_len: int,
                     ref_len: int,
                     smooth_method: str = 'none',
                     smooth_value=None,
                     effective_order: bool = False,
                     max_ngram_order: int = MAX_NGRAM_ORDER) -> BLEUScore:
        """Computes BLEU score from its sufficient statistics with smoothing.

        Smoothing methods (citing "A Systematic Comparison of Smoothing Techniques for Sentence-Level BLEU",
        Boxing Chen and Colin Cherry, WMT 2014: http://aclweb.org/anthology/W14-3346)

        - none: No smoothing.
        - floor: Method 1 (requires small positive value (0.1 in the paper) to be set)
        - add-k: Method 2 (Generalizing Lin and Och, 2004)
        - exp: Method 3 (NIST smoothing method i.e. in use with mteval-v13a.pl)

        :param correct: List of counts of correct ngrams, 1 <= n <= max_ngram_order
        :param total: List of counts of total ngrams, 1 <= n <= max_ngram_order
        :param sys_len: The cumulative system length
        :param ref_len: The cumulative reference length
        :param smooth_method: The smoothing method to use ('floor', 'add-k', 'exp' or 'none')
        :param smooth_value: The smoothing value for `floor` and `add-k` methods. `None` falls back to default value.
        :param effective_order: If `True`, stop including n-gram orders for which precision is 0. This should be
            `True`, if sentence-level BLEU will be computed.
        :param max_ngram_order: If given, it overrides the maximum n-gram order (default: 4) when computing precisions.
        :return: A `BLEUScore` instance.
        """
        assert smooth_method in BLEU.SMOOTH_DEFAULTS.keys(), \
            "Unknown smooth_method {smooth_method!r}"

        # Fetch the default value for floor and add-k
        if smooth_value is None:
            smooth_value = BLEU.SMOOTH_DEFAULTS[smooth_method]

        # Compute brevity penalty
        bp = 1.0
        if sys_len < ref_len:
            bp = math.exp(1 - ref_len / sys_len) if sys_len > 0 else 0.0

        # n-gram precisions
        precisions = [0.0] * max_ngram_order

        # Early stop if there are no matches (#141)
        if not any(correct):
            return BLEUScore(0.0, correct, total, precisions, bp, sys_len, ref_len)

        smooth_mteval = 1.
        eff_order = max_ngram_order
        for n in range(1, len(precisions) + 1):
            if smooth_method == 'add-k' and n > 1:
                correct[n - 1] += smooth_value
                total[n - 1] += smooth_value

            if total[n - 1] == 0:
                break

            # If the system guesses no i-grams, 1 <= i <= max_ngram_order,
            # the BLEU score is 0 (technically undefined). This is a problem for sentence
            # level BLEU or a corpus of short sentences, where systems will get
            # no credit if sentence lengths fall under the max_ngram_order threshold.
            # This fix scales max_ngram_order to the observed maximum order.
            # It is only available through the API and off by default
            if effective_order:
                eff_order = n

            if correct[n - 1] == 0:
                if smooth_method == 'exp':
                    smooth_mteval *= 2
                    precisions[n - 1] = 100. / (smooth_mteval * total[n - 1])
                elif smooth_method == 'floor':
                    precisions[n - 1] = 100. * smooth_value / total[n - 1]
            else:
                precisions[n - 1] = 100. * correct[n - 1] / total[n - 1]

        # Compute BLEU score
        score = bp * math.exp(
            sum([my_log(p) for p in precisions[:eff_order]]) / eff_order)

        return BLEUScore(score, correct, total, precisions, bp, sys_len, ref_len)

def my_log(num: float) -> float:
    """
    Floors the log function

    :param num: the number
    :return: log(num) floored to a very low number
    """

    if num == 0.0:
        return -9999999999
    return math.log(num)
```

Smoothing 'exp' (default): for each order n where `correct[n-1]==0`, `smooth_mteval *= 2; precision = 100/(smooth_mteval*total[n-1])`; if `total[n-1]==0` the loop breaks (precision stays 0.0 and, because `effective_order=False`, `eff_order` stays 4). If NO n-gram order has any match (`not any(correct)`) the score is exactly 0.0. `bp = exp(1 - ref_len/sys_len)` if `sys_len < ref_len` (0.0 when `sys_len == 0`), else 1.0.

### 4.6 RougeScore (ragas `metrics/_rouge_score.py`; wrapper `rouge_score.py`)

Settings: `rouge_type` in {rouge1 (default), rougeL}; `measure_type` in {fmeasure (default), precision, recall}. Wrapper: `RougeScore(rouge_type=settings.rouge_type, mode=settings.measure_type)` (note ragas' own default would be rougeL; we pass explicitly), sample `response=output`, `reference=expected_output`; `RagasResult(score=score, cost=None, details=None)`.
ragas code (verbatim):

```python
    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        assert isinstance(sample.reference, str), "Sample reference must be a string"
        assert isinstance(sample.response, str), "Sample response must be a string"
        scorer = self.rouge_scorer.RougeScorer([self.rouge_type], use_stemmer=True)
        scores = scorer.score(sample.reference, sample.response)
        return getattr(scores[self.rouge_type], self.mode)
```

=> `rouge_score.rouge_scorer.RougeScorer([rouge_type], use_stemmer=True).score(target=reference, prediction=response)[rouge_type].<mode>` (rouge-score 0.1.2; **target is the reference, prediction is the response**; precision = overlap/len(prediction), recall = overlap/len(target)).
Tokenizer (`rouge_score/tokenize.py`, DefaultTokenizer with stemmer): lowercase; replace every run of `[^a-z0-9]+` with a space (so ALL non-ASCII letters/digits become separators); split on `\s+`; tokens longer than 3 chars are stemmed with `nltk.stem.porter.PorterStemmer()` (default mode `NLTK_EXTENSIONS`, NOT the original algorithm -- the Go stemmer must implement NLTK's Porter variant incl. its irregular-form pool); finally keep only tokens matching `^[a-z0-9]+$` (drops empty strings).
Scoring code (verbatim):

```python
def _create_ngrams(tokens, n):
  """Creates ngrams from the given list of tokens.

  Args:
    tokens: A list of tokens from which ngrams are created.
    n: Number of tokens to use, e.g. 2 for bigrams.
  Returns:
    A dictionary mapping each bigram to the number of occurrences.
  """

  ngrams = collections.Counter()
  for ngram in (tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)):
    ngrams[ngram] += 1
  return ngrams

def _score_ngrams(target_ngrams, prediction_ngrams):
  """Compute n-gram based rouge scores.

  Args:
    target_ngrams: A Counter object mapping each ngram to number of
      occurrences for the target text.
    prediction_ngrams: A Counter object mapping each ngram to number of
      occurrences for the prediction text.
  Returns:
    A Score object containing computed scores.
  """

  intersection_ngrams_count = 0
  for ngram in six.iterkeys(target_ngrams):
    intersection_ngrams_count += min(target_ngrams[ngram],
                                     prediction_ngrams[ngram])
  target_ngrams_count = sum(target_ngrams.values())
  prediction_ngrams_count = sum(prediction_ngrams.values())

  precision = intersection_ngrams_count / max(prediction_ngrams_count, 1)
  recall = intersection_ngrams_count / max(target_ngrams_count, 1)
  fmeasure = scoring.fmeasure(precision, recall)

  return scoring.Score(precision=precision, recall=recall, fmeasure=fmeasure)

def _score_lcs(target_tokens, prediction_tokens):
  """Computes LCS (Longest Common Subsequence) rouge scores.

  Args:
    target_tokens: Tokens from the target text.
    prediction_tokens: Tokens from the predicted text.
  Returns:
    A Score object containing computed scores.
  """

  if not target_tokens or not prediction_tokens:
    return scoring.Score(precision=0, recall=0, fmeasure=0)

  # Compute length of LCS from the bottom up in a table (DP appproach).
  lcs_table = _lcs_table(target_tokens, prediction_tokens)
  lcs_length = lcs_table[-1][-1]

  precision = lcs_length / len(prediction_tokens)
  recall = lcs_length / len(target_tokens)
  fmeasure = scoring.fmeasure(precision, recall)

  return scoring.Score(precision=precision, recall=recall, fmeasure=fmeasure)

def _lcs_table(ref, can):
  """Create 2-d LCS score table."""
  rows = len(ref)
  cols = len(can)
  lcs_table = [[0] * (cols + 1) for _ in range(rows + 1)]
  for i in range(1, rows + 1):
    for j in range(1, cols + 1):
      if ref[i - 1] == can[j - 1]:
        lcs_table[i][j] = lcs_table[i - 1][j - 1] + 1
      else:
        lcs_table[i][j] = max(lcs_table[i - 1][j], lcs_table[i][j - 1])
  return lcs_table

def fmeasure(precision, recall):
  """Computes f-measure given precision and recall values."""

  if precision + recall > 0:
    return 2 * precision * recall / (precision + recall)
  else:
    return 0.0
```

rouge1: unigram Counter overlap (`min` counts per token), `precision = overlap / max(pred_count, 1)`, `recall = overlap / max(target_count, 1)`, `fmeasure = 2pr/(p+r)` or 0.0 if `p+r == 0`. rougeL: LCS of the token sequences (classic DP); returns (0,0,0) if either token list is empty; `precision = lcs/len(pred)`, `recall = lcs/len(target)`. Empty text -> 0.0. Verified: rouge1 fmeasure "the cats running quickly" vs "a cat runs quick" = 0.5.
No rounding is applied.

Wrapper sources (verbatim):

```python
    def evaluate(self, entry: RagasBLEUScoreEntry) -> SingleEvaluationResult:
        scorer = BleuScore()

        score = scorer.single_turn_score(
            SingleTurnSample(
                response=entry.output,
                reference=entry.expected_output,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )

    def evaluate(self, entry: RagasROUGEScoreEntry) -> SingleEvaluationResult:
        scorer = RougeScore(
            rouge_type=self.settings.rouge_type,
            mode=self.settings.measure_type,
        )

        score = scorer.single_turn_score(
            SingleTurnSample(
                response=entry.output,
                reference=entry.expected_output,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )
```

---

## 5. Gotchas for the Go port (collected)

1. **Call counts** (excluding repairs; each ragas prompt may add up to 3 repair calls, worst case 4x): Faithfulness 2 (+1 don't-know if score<0.1 and enabled; 1 total if no statements); FactualCorrectness 4 (f1/recall) or 2 (precision); LLMContextRecall (response_context_recall) 1; ResponseRelevancy 1 LLM request with n=3 + 2 embedding requests; SummarizationScore 3; InstanceRubrics 1; LLMSQLEquivalence 1; response_context_precision 1 per retrieved context, SEQUENTIAL (0 for an empty list); context_precision / context_recall / context_f1 / BLEU / ROUGE 0.
2. **Prompt format is byte-sensitive**: schema string glued to "Do not use single quotes ... double quotes,properly escaped ..." with no newline/space; `input:` is lowercase in the data line but `Input:` in examples; instruction whitespace (FactualCorrectness and SQL have leading `\n    ` and trailing `\n    `); pydantic JSON dumps (no HTML escaping, indent 4). Copy strings from section 6.
3. **Temperature**: 0.01 for n=1 (not 0); 0.7 for ResponseRelevancy (all calls incl. repairs); 1.0 for gpt-5 models; the don't-know check uses 0. Repair calls use the same temperature rules.
4. **finish_reason other than stop** (e.g. `length`) aborts with `LLMDidNotFinishException`, no retry. Only RateLimit errors retry (10 attempts, jittered exponential up to 60 s).
5. **Lenient parsing**: partial/truncated JSON is auto-closed; first balanced `{}`/`[]` extracted; pydantic lax coercion (`"1"`->1, `true`->1, `4.0`->4, `"yes"`->true) but `str` fields reject numbers and int fields reject 4.5. Failures go to the repair prompt, whose result is parsed WITHOUT extract_json.
6. **NaN handling**: Faithfulness NaN (no statements / no verdicts) -> wrapper Skipped. ResponseRelevancy all-empty questions -> Skipped. LLMContextRecall NaN (no classifications) -> NOT skipped, score NaN is returned. SummarizationScore with empty answers -> ZeroDivisionError (error). Score NaN cannot be serialised in strict JSON; decide explicitly in Go. response_context_precision never yields NaN (empty contexts or all-zero verdicts -> 0.0, thanks to the 1e-10 denominator); non-LLM context_recall is NaN only for an empty expected list, which the wrapper short-circuits to 1.0.
7. **Faithfulness denominator** = number of verdicts returned (may differ from number of statements); `verdict` truthiness (any non-zero int = faithful).
8. **FactualCorrectness**: `mode="recall"` still uses tp from the response-claims-vs-reference direction; score rounded to 2 decimals (half-even); details labels follow completion order; more verdicts than claims -> IndexError in wrapper details.
9. **ResponseRelevancy details** print a numpy array (`[a b c]`, 8 significant digits) for "Similarity"; `any_noncommittal` (details) vs `all` (score).
10. **SummarizationScore** counts characters (code points), not bytes; `1e-10` epsilon; `"1"` exact (case-insensitive) match only.
11. **BLEU only scores the FIRST ". "-separated response sentence** against all reference sentences as multiple references (see 4.5). ROUGE tokenizer drops all non-ASCII letters and needs NLTK-mode Porter stemming.
12. **SQL evaluator returns `passed` only** (no `score`); details use the misspelling "explaination".
13. **Token limit is a skip, not a truncation** (`Total tokens exceed the maximum of {limit}: {total}`), counted with litellm's tokenizer for `settings.model`, per field (each context separately), default `max_tokens=2048`. Which fields count differs per evaluator (see each section's `check_max_tokens` list: Faithfulness input+output+non-empty contexts; FactualCorrectness output+expected_output; Recall input+output+expected_output+contexts; Relevancy input+output; Summarization output+contexts; Rubrics input+output+expected_output; SQL output+expected_output+expected_contexts; response_context_precision input + (expected_output if truthy, else output) + all contexts, empties not dropped). The non-LLM evaluators (context_precision, context_recall, context_f1, BLEU, ROUGE) have NO token check and never skip.
14. Faithfulness filters empty-string contexts; the other context-taking metrics do not (`"\n".join` includes empties as blank lines).
15. Cost includes ALL calls (repairs, don't-know check) via the OpenAI callback token counts; embedding cost is not included.
16. **response_context_precision picks the scorer by truthiness of `expected_output`** (reference wins; `output` is then ignored and not even token-counted). Neither given -> Skipped "Either output or expected_output must be provided." before anything else.
17. **The `1e-10` epsilon is part of the observable score** for every average-precision metric (LLM and non-LLM precision): a single perfect hit is `0.9999999999`, verdicts [1,0,1] give `0.8333333332916666`; do not "clean" it to 1.0/0.8333.... Non-LLM recall has no epsilon (`hits/len(expected)`).
18. **Threshold asymmetry in the non-LLM metrics:** precision keeps a context when best similarity `>= 0.5`, recall counts an expected context when best similarity `> 0.5` (strict). Precision iterates RETRIEVED contexts (rank-aware, order matters), recall iterates EXPECTED contexts (order-insensitive). context_recall / context_f1 / context_precision use different empty-list rules (both empty: precision 1.0, recall 1.0, F1 uses those; expected empty: precision 0.0 but recall 1.0; contexts empty: both 0.0), and context_f1 always emits `Precision: {p}, Recall: {r}` details.
19. **rapidfuzz parity** (section 4.1): work on runes (code points), no preprocessing; Levenshtein normalised by max length; Hamming pads (length gap counts as mismatches); Jaro window `max//2 - 1`, transposition count is FLOOR-divided by 2; Jaro-Winkler boost only when jaro `> 0.7`, prefix capped at 4, weight 0.1; two empty strings are perfectly similar (1.0). Use the verified reference code.
20. **Python float formatting in details** (context_f1 `Precision: ..., Recall: ...`): shortest round-trip repr with `.0` for whole numbers (`1.0`, `0.0`), exponent style `1e-05`; not Go's default `%v`.

---

## 6. Prompts (generated verbatim from ragas 0.4.3)

<!-- GENERATED SECTION: rendered from ragas 0.4.3 objects by .claude/tmp/gen_prompts.py -->

### Shared: FixOutputFormat (repair) prompt

#### fix_output_format

- prompt class: `ragas.prompt.pydantic_prompt.FixOutputFormat`; `name` = `fix_output_format`
- input model `OutputStringAndPrompt`, output model `StringIO`
- instruction (exact Python repr, whitespace matters): `'The output string did not satisfy the constraints given in the prompt. Fix the output string and return it.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "output_string": {
      "title": "Output String",
      "type": "string"
    },
    "prompt_value": {
      "title": "Prompt Value",
      "type": "string"
    }
  },
  "required": ["output_string", "prompt_value"],
  "title": "OutputStringAndPrompt",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": { "text": { "title": "Text", "type": "string" } },
  "required": ["text"],
  "title": "StringIO",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
The output string did not satisfy the constraints given in the prompt. Fix the output string and return it.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"text": {"title": "Text", "type": "string"}}, "required": ["text"], "title": "StringIO", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

-----------------------------

Now perform the same with the following input
input: {
    "output_string": "<<BAD_OUTPUT_STRING>>",
    "prompt_value": "<<FULL_ORIGINAL_PROMPT_STRING>>"
}
Output:
```

### Faithfulness prompts

#### StatementGeneratorPrompt

- prompt class: `ragas.metrics._faithfulness.StatementGeneratorPrompt`; `name` = `statement_generator_prompt`
- input model `StatementGeneratorInput`, output model `StatementGeneratorOutput`
- instruction (exact Python repr, whitespace matters): `'Given a question and an answer, analyze the complexity of each sentence in the answer. Break down each sentence into one or more fully understandable statements. Ensure that no pronouns are used in any statement. Format the outputs in JSON.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "question": {
      "description": "The question to answer",
      "title": "Question",
      "type": "string"
    },
    "answer": {
      "description": "The answer to the question",
      "title": "Answer",
      "type": "string"
    }
  },
  "required": ["question", "answer"],
  "title": "StatementGeneratorInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "statements": {
      "description": "The generated statements",
      "items": { "type": "string" },
      "title": "Statements",
      "type": "array"
    }
  },
  "required": ["statements"],
  "title": "StatementGeneratorOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Given a question and an answer, analyze the complexity of each sentence in the answer. Break down each sentence into one or more fully understandable statements. Ensure that no pronouns are used in any statement. Format the outputs in JSON.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"statements": {"description": "The generated statements", "items": {"type": "string"}, "title": "Statements", "type": "array"}}, "required": ["statements"], "title": "StatementGeneratorOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "Who was Albert Einstein and what is he best known for?",
    "answer": "He was a German-born theoretical physicist, widely acknowledged to be one of the greatest and most influential physicists of all time. He was best known for developing the theory of relativity, he also made important contributions to the development of the theory of quantum mechanics."
}
Output: {
    "statements": [
        "Albert Einstein was a German-born theoretical physicist.",
        "Albert Einstein is recognized as one of the greatest and most influential physicists of all time.",
        "Albert Einstein was best known for developing the theory of relativity.",
        "Albert Einstein also made important contributions to the development of the theory of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "question": "<<QUESTION>>",
    "answer": "<<ANSWER>>"
}
Output:
```

#### NLIStatementPrompt

Also used by FactualCorrectness (verify_claims), with `context` = premise and `statements` = claims.

- prompt class: `ragas.metrics._faithfulness.NLIStatementPrompt`; `name` = `n_l_i_statement_prompt`
- input model `NLIStatementInput`, output model `NLIStatementOutput`
- instruction (exact Python repr, whitespace matters): `'Your task is to judge the faithfulness of a series of statements based on a given context. For each statement you must return verdict as 1 if the statement can be directly inferred based on the context or 0 if the statement can not be directly inferred based on the context.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "context": {
      "description": "The context of the question",
      "title": "Context",
      "type": "string"
    },
    "statements": {
      "description": "The statements to judge",
      "items": {
        "type": "string"
      },
      "title": "Statements",
      "type": "array"
    }
  },
  "required": ["context", "statements"],
  "title": "NLIStatementInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "$defs": {
    "StatementFaithfulnessAnswer": {
      "properties": {
        "statement": {
          "description": "the original statement, word-by-word",
          "title": "Statement",
          "type": "string"
        },
        "reason": {
          "description": "the reason of the verdict",
          "title": "Reason",
          "type": "string"
        },
        "verdict": {
          "description": "the verdict(0/1) of the faithfulness.",
          "title": "Verdict",
          "type": "integer"
        }
      },
      "required": ["statement", "reason", "verdict"],
      "title": "StatementFaithfulnessAnswer",
      "type": "object"
    }
  },
  "properties": {
    "statements": {
      "items": { "$ref": "#/$defs/StatementFaithfulnessAnswer" },
      "title": "Statements",
      "type": "array"
    }
  },
  "required": ["statements"],
  "title": "NLIStatementOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Your task is to judge the faithfulness of a series of statements based on a given context. For each statement you must return verdict as 1 if the statement can be directly inferred based on the context or 0 if the statement can not be directly inferred based on the context.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"$defs": {"StatementFaithfulnessAnswer": {"properties": {"statement": {"description": "the original statement, word-by-word", "title": "Statement", "type": "string"}, "reason": {"description": "the reason of the verdict", "title": "Reason", "type": "string"}, "verdict": {"description": "the verdict(0/1) of the faithfulness.", "title": "Verdict", "type": "integer"}}, "required": ["statement", "reason", "verdict"], "title": "StatementFaithfulnessAnswer", "type": "object"}}, "properties": {"statements": {"items": {"$ref": "#/$defs/StatementFaithfulnessAnswer"}, "title": "Statements", "type": "array"}}, "required": ["statements"], "title": "NLIStatementOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "context": "John is a student at XYZ University. He is pursuing a degree in Computer Science. He is enrolled in several courses this semester, including Data Structures, Algorithms, and Database Management. John is a diligent student and spends a significant amount of time studying and completing assignments. He often stays late in the library to work on his projects.",
    "statements": [
        "John is majoring in Biology.",
        "John is taking a course on Artificial Intelligence.",
        "John is a dedicated student.",
        "John has a part-time job."
    ]
}
Output: {
    "statements": [
        {
            "statement": "John is majoring in Biology.",
            "reason": "John's major is explicitly mentioned as Computer Science. There is no information suggesting he is majoring in Biology.",
            "verdict": 0
        },
        {
            "statement": "John is taking a course on Artificial Intelligence.",
            "reason": "The context mentions the courses John is currently enrolled in, and Artificial Intelligence is not mentioned. Therefore, it cannot be deduced that John is taking a course on AI.",
            "verdict": 0
        },
        {
            "statement": "John is a dedicated student.",
            "reason": "The context states that he spends a significant amount of time studying and completing assignments. Additionally, it mentions that he often stays late in the library to work on his projects, which implies dedication.",
            "verdict": 1
        },
        {
            "statement": "John has a part-time job.",
            "reason": "There is no information given in the context about John having a part-time job.",
            "verdict": 0
        }
    ]
}

Example 2
Input: {
    "context": "Photosynthesis is a process used by plants, algae, and certain bacteria to convert light energy into chemical energy.",
    "statements": [
        "Albert Einstein was a genius."
    ]
}
Output: {
    "statements": [
        {
            "statement": "Albert Einstein was a genius.",
            "reason": "The context and statement are unrelated",
            "verdict": 0
        }
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "context": "<<CONTEXTS joined by \\n>>",
    "statements": [
        "<<STATEMENT 1>>",
        "<<STATEMENT 2>>"
    ]
}
Output:
```

### FactualCorrectness prompts

#### ClaimDecompositionPrompt (atomicity=low, coverage=low)

Instruction is the same for all four variants; only `examples` differ.

- prompt class: `ragas.metrics._factual_correctness.ClaimDecompositionPrompt`; `name` = `claim_decomposition_prompt`
- input model `ClaimDecompositionInput`, output model `ClaimDecompositionOutput`
- instruction (exact Python repr, whitespace matters): `'\n    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.\n    Follow the level of atomicity and coverage as shown in the examples.\n    '`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "response": {
      "title": "Response",
      "type": "string"
    }
  },
  "required": ["response"],
  "title": "ClaimDecompositionInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "claims": { "items": { "type": "string" }, "title": "Decomposed Claims", "type": "array" }
  },
  "required": ["claims"],
  "title": "ClaimDecompositionOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text

    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.

Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician and philosopher."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German physicist.",
        "Albert Einstein developed relativity and contributed to quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "response": "<<TEXT TO DECOMPOSE>>"
}
Output:
```

#### ClaimDecompositionPrompt (atomicity=low, coverage=high)

Instruction is the same for all four variants; only `examples` differ.

- prompt class: `ragas.metrics._factual_correctness.ClaimDecompositionPrompt`; `name` = `claim_decomposition_prompt`
- input model `ClaimDecompositionInput`, output model `ClaimDecompositionOutput`
- instruction (exact Python repr, whitespace matters): `'\n    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.\n    Follow the level of atomicity and coverage as shown in the examples.\n    '`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "response": {
      "title": "Response",
      "type": "string"
    }
  },
  "required": ["response"],
  "title": "ClaimDecompositionInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "claims": { "items": { "type": "string" }, "title": "Decomposed Claims", "type": "array" }
  },
  "required": ["claims"],
  "title": "ClaimDecompositionOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text

    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.

Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a French mathematician, philosopher, and food critic."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity and also contributed to the development of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "response": "<<TEXT TO DECOMPOSE>>"
}
Output:
```

#### ClaimDecompositionPrompt (atomicity=high, coverage=low)

Instruction is the same for all four variants; only `examples` differ.

- prompt class: `ragas.metrics._factual_correctness.ClaimDecompositionPrompt`; `name` = `claim_decomposition_prompt`
- input model `ClaimDecompositionInput`, output model `ClaimDecompositionOutput`
- instruction (exact Python repr, whitespace matters): `'\n    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.\n    Follow the level of atomicity and coverage as shown in the examples.\n    '`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "response": {
      "title": "Response",
      "type": "string"
    }
  },
  "required": ["response"],
  "title": "ClaimDecompositionInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "claims": { "items": { "type": "string" }, "title": "Decomposed Claims", "type": "array" }
  },
  "required": ["claims"],
  "title": "ClaimDecompositionOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text

    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.

Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician.",
        "Charles Babbage was a philosopher."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity."
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "response": "<<TEXT TO DECOMPOSE>>"
}
Output:
```

#### ClaimDecompositionPrompt (atomicity=high, coverage=high)

Instruction is the same for all four variants; only `examples` differ.

- prompt class: `ragas.metrics._factual_correctness.ClaimDecompositionPrompt`; `name` = `claim_decomposition_prompt`
- input model `ClaimDecompositionInput`, output model `ClaimDecompositionOutput`
- instruction (exact Python repr, whitespace matters): `'\n    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.\n    Follow the level of atomicity and coverage as shown in the examples.\n    '`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "response": {
      "title": "Response",
      "type": "string"
    }
  },
  "required": ["response"],
  "title": "ClaimDecompositionInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "claims": { "items": { "type": "string" }, "title": "Decomposed Claims", "type": "array" }
  },
  "required": ["claims"],
  "title": "ClaimDecompositionOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text

    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.

Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"claims": {"items": {"type": "string"}, "title": "Decomposed Claims", "type": "array"}}, "required": ["claims"], "title": "ClaimDecompositionOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Charles Babbage was a French mathematician, philosopher, and food critic."
}
Output: {
    "claims": [
        "Charles Babbage was a mathematician.",
        "Charles Babbage was a philosopher.",
        "Charles Babbage was a food critic.",
        "Charles Babbage was French."
    ]
}

Example 2
Input: {
    "response": "Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
}
Output: {
    "claims": [
        "Albert Einstein was a German theoretical physicist.",
        "Albert Einstein developed the theory of relativity.",
        "Albert Einstein contributed to the development of quantum mechanics."
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "response": "<<TEXT TO DECOMPOSE>>"
}
Output:
```

### LLMContextRecall prompt

#### ContextRecallClassificationPrompt

- prompt class: `ragas.metrics._context_recall.ContextRecallClassificationPrompt`; `name` = `context_recall_classification_prompt`
- input model `QCA`, output model `ContextRecallClassifications`
- instruction (exact Python repr, whitespace matters): `"Given a context, and an answer, analyze each sentence in the answer and classify if the sentence can be attributed to the given context or not. Use only 'Yes' (1) or 'No' (0) as a binary classification. Output json with reason."`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "question": {
      "title": "Question",
      "type": "string"
    },
    "context": {
      "title": "Context",
      "type": "string"
    },
    "answer": {
      "title": "Answer",
      "type": "string"
    }
  },
  "required": ["question", "context", "answer"],
  "title": "QCA",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "$defs": {
    "ContextRecallClassification": {
      "properties": {
        "statement": { "title": "Statement", "type": "string" },
        "reason": { "title": "Reason", "type": "string" },
        "attributed": { "title": "Attributed", "type": "integer" }
      },
      "required": ["statement", "reason", "attributed"],
      "title": "ContextRecallClassification",
      "type": "object"
    }
  },
  "properties": {
    "classifications": {
      "items": { "$ref": "#/$defs/ContextRecallClassification" },
      "title": "Classifications",
      "type": "array"
    }
  },
  "required": ["classifications"],
  "title": "ContextRecallClassifications",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Given a context, and an answer, analyze each sentence in the answer and classify if the sentence can be attributed to the given context or not. Use only 'Yes' (1) or 'No' (0) as a binary classification. Output json with reason.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"$defs": {"ContextRecallClassification": {"properties": {"statement": {"title": "Statement", "type": "string"}, "reason": {"title": "Reason", "type": "string"}, "attributed": {"title": "Attributed", "type": "integer"}}, "required": ["statement", "reason", "attributed"], "title": "ContextRecallClassification", "type": "object"}}, "properties": {"classifications": {"items": {"$ref": "#/$defs/ContextRecallClassification"}, "title": "Classifications", "type": "array"}}, "required": ["classifications"], "title": "ContextRecallClassifications", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "What can you tell me about albert Albert Einstein?",
    "context": "Albert Einstein (14 March 1879 - 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass-energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
    "answer": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics. He published 4 papers in 1905. Einstein moved to Switzerland in 1895."
}
Output: {
    "classifications": [
        {
            "statement": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time.",
            "reason": "The date of birth of Einstein is mentioned clearly in the context.",
            "attributed": 1
        },
        {
            "statement": "He received the 1921 Nobel Prize in Physics for his services to theoretical physics.",
            "reason": "The exact sentence is present in the given context.",
            "attributed": 1
        },
        {
            "statement": "He published 4 papers in 1905.",
            "reason": "There is no mention about papers he wrote in the given context.",
            "attributed": 0
        },
        {
            "statement": "Einstein moved to Switzerland in 1895.",
            "reason": "There is no supporting evidence for this in the given context.",
            "attributed": 0
        }
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "question": "<<QUESTION>>",
    "context": "<<CONTEXTS joined by \\n>>",
    "answer": "<<REFERENCE (expected_output)>>"
}
Output:
```

### LLMContextPrecision prompt (WithReference and WithoutReference)

#### ContextPrecisionPrompt

One call per retrieved context. `answer` is the reference for LLMContextPrecisionWithReference and the response for LLMContextPrecisionWithoutReference; the prompt is identical otherwise.

- prompt class: `ragas.metrics._context_precision.ContextPrecisionPrompt`; `name` = `context_precision_prompt`
- input model `QAC`, output model `Verification`
- instruction (exact Python repr, whitespace matters): `'Given question, answer and context verify if the context was useful in arriving at the given answer. Give verdict as "1" if useful and "0" if not with json output.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "question": {
      "description": "Question",
      "title": "Question",
      "type": "string"
    },
    "context": {
      "description": "Context",
      "title": "Context",
      "type": "string"
    },
    "answer": {
      "description": "Answer",
      "title": "Answer",
      "type": "string"
    }
  },
  "required": ["question", "context", "answer"],
  "title": "QAC",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "reason": { "description": "Reason for verification", "title": "Reason", "type": "string" },
    "verdict": {
      "description": "Binary (0/1) verdict of verification",
      "title": "Verdict",
      "type": "integer"
    }
  },
  "required": ["reason", "verdict"],
  "title": "Verification",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Given question, answer and context verify if the context was useful in arriving at the given answer. Give verdict as "1" if useful and "0" if not with json output.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"reason": {"description": "Reason for verification", "title": "Reason", "type": "string"}, "verdict": {"description": "Binary (0/1) verdict of verification", "title": "Verdict", "type": "integer"}}, "required": ["reason", "verdict"], "title": "Verification", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "question": "What can you tell me about Albert Einstein?",
    "context": "Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass–energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
    "answer": "Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics."
}
Output: {
    "reason": "The provided context was indeed useful in arriving at the given answer. The context includes key information about Albert Einstein's life and contributions, which are reflected in the answer.",
    "verdict": 1
}

Example 2
Input: {
    "question": "who won 2020 icc world cup?",
    "context": "The 2022 ICC Men's T20 World Cup, held from October 16 to November 13, 2022, in Australia, was the eighth edition of the tournament. Originally scheduled for 2020, it was postponed due to the COVID-19 pandemic. England emerged victorious, defeating Pakistan by five wickets in the final to clinch their second ICC Men's T20 World Cup title.",
    "answer": "England"
}
Output: {
    "reason": "the context was useful in clarifying the situation regarding the 2020 ICC World Cup and indicating that England was the winner of the tournament that was intended to be held in 2020 but actually took place in 2022.",
    "verdict": 1
}

Example 3
Input: {
    "question": "What is the tallest mountain in the world?",
    "context": "The Andes is the longest continental mountain range in the world, located in South America. It stretches across seven countries and features many of the highest peaks in the Western Hemisphere. The range is known for its diverse ecosystems, including the high-altitude Andean Plateau and the Amazon rainforest.",
    "answer": "Mount Everest."
}
Output: {
    "reason": "the provided context discusses the Andes mountain range, which, while impressive, does not include Mount Everest or directly relate to the question about the world's tallest mountain.",
    "verdict": 0
}
-----------------------------

Now perform the same with the following input
input: {
    "question": "<<QUESTION (input)>>",
    "context": "<<ONE retrieved context>>",
    "answer": "<<REFERENCE (expected_output) or RESPONSE (output)>>"
}
Output:
```

### ResponseRelevancy prompt

#### ResponseRelevancePrompt

- prompt class: `ragas.metrics._answer_relevance.ResponseRelevancePrompt`; `name` = `response_relevance_prompt`
- input model `ResponseRelevanceInput`, output model `ResponseRelevanceOutput`
- instruction (exact Python repr, whitespace matters): `'Generate a question for the given answer and Identify if answer is noncommittal. Give noncommittal as 1 if the answer is noncommittal and 0 if the answer is committal. A noncommittal answer is one that is evasive, vague, or ambiguous. For example, "I don\'t know" or "I\'m not sure" are noncommittal answers'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "response": {
      "title": "Response",
      "type": "string"
    }
  },
  "required": ["response"],
  "title": "ResponseRelevanceInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "question": { "title": "Question", "type": "string" },
    "noncommittal": { "title": "Noncommittal", "type": "integer" }
  },
  "required": ["question", "noncommittal"],
  "title": "ResponseRelevanceOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Generate a question for the given answer and Identify if answer is noncommittal. Give noncommittal as 1 if the answer is noncommittal and 0 if the answer is committal. A noncommittal answer is one that is evasive, vague, or ambiguous. For example, "I don't know" or "I'm not sure" are noncommittal answers
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"question": {"title": "Question", "type": "string"}, "noncommittal": {"title": "Noncommittal", "type": "integer"}}, "required": ["question", "noncommittal"], "title": "ResponseRelevanceOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "response": "Albert Einstein was born in Germany."
}
Output: {
    "question": "Where was Albert Einstein born?",
    "noncommittal": 0
}

Example 2
Input: {
    "response": "I don't know about the  groundbreaking feature of the smartphone invented in 2023 as am unaware of information beyond 2022. "
}
Output: {
    "question": "What was the groundbreaking feature of the smartphone invented in 2023?",
    "noncommittal": 1
}
-----------------------------

Now perform the same with the following input
input: {
    "response": "<<RESPONSE>>"
}
Output:
```

### SummarizationScore prompts

#### ExtractKeyphrasePrompt

- prompt class: `ragas.metrics._summarization.ExtractKeyphrasePrompt`; `name` = `extract_keyphrase_prompt`
- input model `StringIO`, output model `ExtractedKeyphrases`
- instruction (exact Python repr, whitespace matters): `'Extract keyphrases of type: Person, Organization, Location, Date/Time, Monetary Values, and Percentages.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "text": {
      "title": "Text",
      "type": "string"
    }
  },
  "required": ["text"],
  "title": "StringIO",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "keyphrases": { "items": { "type": "string" }, "title": "Keyphrases", "type": "array" }
  },
  "required": ["keyphrases"],
  "title": "ExtractedKeyphrases",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Extract keyphrases of type: Person, Organization, Location, Date/Time, Monetary Values, and Percentages.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"keyphrases": {"items": {"type": "string"}, "title": "Keyphrases", "type": "array"}}, "required": ["keyphrases"], "title": "ExtractedKeyphrases", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "text": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023."
}
Output: {
    "keyphrases": [
        "Apple Inc.",
        "Cupertino, California",
        "Steve Jobs",
        "1976",
        "$3 trillion",
        "2023"
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "text": "<<CONTEXTS joined by \\n>>"
}
Output:
```

#### GenerateQuestionsPrompt

- prompt class: `ragas.metrics._summarization.GenerateQuestionsPrompt`; `name` = `generate_questions_prompt`
- input model `GenerateQuestionsPromptInput`, output model `QuestionsGenerated`
- instruction (exact Python repr, whitespace matters): `"Based on the given text and keyphrases, generate closed-ended questions that can be answered with '1' if the question can be answered using the text, or '0' if it cannot. The questions should ALWAYS result in a '1' based on the given text."`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "text": {
      "title": "Text",
      "type": "string"
    },
    "keyphrases": {
      "items": {
        "type": "string"
      },
      "title": "Keyphrases",
      "type": "array"
    }
  },
  "required": ["text", "keyphrases"],
  "title": "GenerateQuestionsPromptInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "questions": { "items": { "type": "string" }, "title": "Questions", "type": "array" }
  },
  "required": ["questions"],
  "title": "QuestionsGenerated",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Based on the given text and keyphrases, generate closed-ended questions that can be answered with '1' if the question can be answered using the text, or '0' if it cannot. The questions should ALWAYS result in a '1' based on the given text.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"questions": {"items": {"type": "string"}, "title": "Questions", "type": "array"}}, "required": ["questions"], "title": "QuestionsGenerated", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "text": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
    "keyphrases": [
        "Apple Inc.",
        "Cupertino, California",
        "Steve Jobs",
        "1976",
        "$3 trillion",
        "2023"
    ]
}
Output: {
    "questions": [
        "Is Apple Inc. a technology company?",
        "Is Apple Inc. based in Cupertino, California?",
        "Was Apple Inc. founded by Steve Jobs?",
        "Was Apple Inc. founded in 1976?",
        "Did Apple Inc. reach a market capitalization of $3 trillion?",
        "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?"
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "text": "<<CONTEXTS joined by \\n>>",
    "keyphrases": [
        "<<kp1>>",
        "<<kp2>>"
    ]
}
Output:
```

#### GenerateAnswersPrompt

- prompt class: `ragas.metrics._summarization.GenerateAnswersPrompt`; `name` = `generate_answers_prompt`
- input model `SummaryAndQuestions`, output model `AnswersGenerated`
- instruction (exact Python repr, whitespace matters): `"Based on the list of close-ended '1' or '0' questions, generate a JSON with key 'answers', which is a list of strings that determines whether the provided summary contains sufficient information to answer EACH question. Answers should STRICTLY be either '1' or '0'. Answer '0' if the provided summary does not contain enough information to answer the question and answer '1' if the provided summary can answer the question."`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "summary": {
      "title": "Summary",
      "type": "string"
    },
    "questions": {
      "items": {
        "type": "string"
      },
      "title": "Questions",
      "type": "array"
    }
  },
  "required": ["summary", "questions"],
  "title": "SummaryAndQuestions",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "answers": { "items": { "type": "string" }, "title": "Answers", "type": "array" }
  },
  "required": ["answers"],
  "title": "AnswersGenerated",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Based on the list of close-ended '1' or '0' questions, generate a JSON with key 'answers', which is a list of strings that determines whether the provided summary contains sufficient information to answer EACH question. Answers should STRICTLY be either '1' or '0'. Answer '0' if the provided summary does not contain enough information to answer the question and answer '1' if the provided summary can answer the question.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"answers": {"items": {"type": "string"}, "title": "Answers", "type": "array"}}, "required": ["answers"], "title": "AnswersGenerated", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "summary": "Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
    "questions": [
        "Is Apple Inc. a technology company?",
        "Is Apple Inc. based in Cupertino, California?",
        "Was Apple Inc. founded by Steve Jobs?",
        "Was Apple Inc. founded in 1976?",
        "Did Apple Inc. reach a market capitalization of $3 trillion?",
        "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?",
        "Is Apple Inc. a major software company?",
        "Is Apple Inc. known for the iPhone?",
        "Was Steve Jobs the co-founder of Apple Inc.?"
    ]
}
Output: {
    "answers": [
        "1",
        "1",
        "1",
        "1",
        "1",
        "1",
        "0",
        "0",
        "1"
    ]
}
-----------------------------

Now perform the same with the following input
input: {
    "summary": "<<RESPONSE>>",
    "questions": [
        "<<q1>>",
        "<<q2>>"
    ]
}
Output:
```

### InstanceRubrics prompt (SingleTurnPrompt from _instance_specific_rubrics.py)

#### SingleTurnPrompt (InstanceRubrics)

No examples. The 'Example' section is empty, so the text between the schema sentence and the `-----` rule is just the newline joins. Fields that are None are omitted from `input:` (exclude_none=True).

- prompt class: `ragas.metrics._instance_specific_rubrics.SingleTurnPrompt`; `name` = `single_turn_prompt`
- input model `SingleTurnInputWithRubric`, output model `ScoreFeedback`
- instruction (exact Python repr, whitespace matters): `'Your task is to assign an appropriate score and provide feedback to the inputs based solely on the scoring criteria passed in the input.'`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "user_input": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "The input to the llm system",
      "title": "User Input"
    },
    "response": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "The response from the llm system",
      "title": "Response"
    },
    "retrieved_contexts": {
      "anyOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "The retrieved contexts from the llm system",
      "title": "Retrieved Contexts"
    },
    "reference_contexts": {
      "anyOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "The reference contexts for the evaluation",
      "title": "Reference Contexts"
    },
    "reference": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "The reference answer for evaluation",
      "title": "Reference"
    },
    "rubrics": {
      "additionalProperties": {
        "type": "string"
      },
      "description": "The rubric for evaluating this instance",
      "title": "Rubrics",
      "type": "object"
    }
  },
  "required": ["rubrics"],
  "title": "SingleTurnInputWithRubric",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "feedback": {
      "description": "The feedback for the response",
      "title": "Feedback",
      "type": "string"
    },
    "score": {
      "description": "The score given to the response",
      "title": "Score",
      "type": "integer"
    }
  },
  "required": ["feedback", "score"],
  "title": "ScoreFeedback",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text
Your task is to assign an appropriate score and provide feedback to the inputs based solely on the scoring criteria passed in the input.
Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"feedback": {"description": "The feedback for the response", "title": "Feedback", "type": "string"}, "score": {"description": "The score given to the response", "title": "Score", "type": "integer"}}, "required": ["feedback", "score"], "title": "ScoreFeedback", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

-----------------------------

Now perform the same with the following input
input: {
    "user_input": "<<INPUT>>",
    "response": "<<OUTPUT>>",
    "reference": "<<EXPECTED_OUTPUT>>",
    "rubrics": {
        "score1_description": "<<r1>>",
        "score2_description": "<<r2>>"
    }
}
Output:
```

### LLMSQLEquivalence prompt

#### EquivalencePrompt

- prompt class: `ragas.metrics._sql_semantic_equivalence.EquivalencePrompt`; `name` = `equivalence_prompt`
- input model `EquivalenceInput`, output model `EquivalenceOutput`
- instruction (exact Python repr, whitespace matters): `'\n    Explain and compare two SQL queries (Q1 and Q2) based on the provided database schema. First, explain each query, then determine if they have significant logical differences.\n    '`

Input model JSON schema (documentation only; the input is rendered as data, not schema):

```json
{
  "properties": {
    "reference": {
      "description": "Reference SQL",
      "title": "Reference",
      "type": "string"
    },
    "response": {
      "description": "Generated SQL",
      "title": "Response",
      "type": "string"
    },
    "database_schema": {
      "description": "Reference SQL schema",
      "title": "Database Schema",
      "type": "string"
    }
  },
  "required": ["reference", "response", "database_schema"],
  "title": "EquivalenceInput",
  "type": "object"
}
```

Output model JSON schema (this exact `json.dumps(...)` string, single line, is embedded in the prompt):

```json
{
  "properties": {
    "response_query_explaination": {
      "description": "Explanation of the generated SQL",
      "title": "Response Query Explaination",
      "type": "string"
    },
    "reference_query_explaination": {
      "description": "Explanation of the reference SQL",
      "title": "Reference Query Explaination",
      "type": "string"
    },
    "equivalence": {
      "description": "Whether the generated SQL is equivalent to the reference SQL",
      "title": "Equivalence",
      "type": "boolean"
    }
  },
  "required": ["response_query_explaination", "reference_query_explaination", "equivalence"],
  "title": "EquivalenceOutput",
  "type": "object"
}
```

Full rendered prompt string sent to the LLM, `PydanticPrompt.to_string(data)` with placeholder input (everything before `input: ` is fixed text; examples are included verbatim):

```text

    Explain and compare two SQL queries (Q1 and Q2) based on the provided database schema. First, explain each query, then determine if they have significant logical differences.

Please return the output in a JSON format that complies with the following schema as specified in JSON Schema:
{"properties": {"response_query_explaination": {"description": "Explanation of the generated SQL", "title": "Response Query Explaination", "type": "string"}, "reference_query_explaination": {"description": "Explanation of the reference SQL", "title": "Reference Query Explaination", "type": "string"}, "equivalence": {"description": "Whether the generated SQL is equivalent to the reference SQL", "title": "Equivalence", "type": "boolean"}}, "required": ["response_query_explaination", "reference_query_explaination", "equivalence"], "title": "EquivalenceOutput", "type": "object"}Do not use single quotes in your response but double quotes,properly escaped with a backslash.

--------EXAMPLES-----------
Example 1
Input: {
    "reference": "SELECT id, name FROM users WHERE active = 1;",
    "response": "SELECT id, name FROM users WHERE active = true;",
    "database_schema": "\n                    Table users:\n                    - id: INT\n                    - name: VARCHAR\n                    - active: BOOLEAN\n                "
}
Output: {
    "response_query_explaination": "The generated SQL query retrieves the id and name of users where the active field is true.",
    "reference_query_explaination": "The reference SQL query retrieves the id and name of users where the active field equals 1.",
    "equivalence": true
}
-----------------------------

Now perform the same with the following input
input: {
    "reference": "<<REFERENCE SQL>>",
    "response": "<<RESPONSE SQL>>",
    "database_schema": "<<expected_contexts joined by \\n>>"
}
Output:
```
