/**
 * Tests for HTTP Agent Utilities
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  buildHttpAgentTarget,
  buildInputsFromBodyTemplate,
  convertHttpComponentConfig,
  extractVariablesFromBodyTemplate,
} from "../httpAgentUtils";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";

describe("extractVariablesFromBodyTemplate", () => {
  it("extracts simple variables from body template", () => {
    const template = '{"input": "{{input}}"}';
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables).toEqual(["input"]);
  });

  it("extracts multiple variables", () => {
    const template = '{"thread_id": "{{thread_id}}", "messages": {{messages}}}';
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables).toContain("thread_id");
    expect(variables).toContain("messages");
    expect(variables.length).toBe(2);
  });

  it("returns empty array for undefined template", () => {
    const variables = extractVariablesFromBodyTemplate(undefined);
    expect(variables).toEqual([]);
  });

  it("returns empty array for template without variables", () => {
    const template = '{"message": "Hello world"}';
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables).toEqual([]);
  });

  it("deduplicates repeated variables", () => {
    const template = '{"first": "{{input}}", "second": "{{input}}"}';
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables).toEqual(["input"]);
  });

  it("handles variable names with underscores and numbers", () => {
    const template = '{"a": "{{var_1}}", "b": "{{my_variable_2}}"}';
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables).toContain("var_1");
    expect(variables).toContain("my_variable_2");
  });

  it("handles multiline templates", () => {
    const template = `{
      "thread_id": "{{thread_id}}",
      "input": "{{input}}",
      "context": {{context}}
    }`;
    const variables = extractVariablesFromBodyTemplate(template);
    expect(variables.length).toBe(3);
    expect(variables).toContain("thread_id");
    expect(variables).toContain("input");
    expect(variables).toContain("context");
  });
});

describe("buildInputsFromBodyTemplate", () => {
  it("builds inputs from body template variables", () => {
    const template = '{"input": "{{input}}", "context": "{{context}}"}';
    const inputs = buildInputsFromBodyTemplate(template);
    expect(inputs.length).toBe(2);
    expect(inputs[0]).toEqual({ identifier: "input", type: "str" });
    expect(inputs[1]).toEqual({ identifier: "context", type: "str" });
  });

  it("returns empty array for undefined template", () => {
    const inputs = buildInputsFromBodyTemplate(undefined);
    expect(inputs).toEqual([]);
  });

  it("all inputs have type str", () => {
    const template = '{"a": "{{a}}", "b": "{{b}}", "c": "{{c}}"}';
    const inputs = buildInputsFromBodyTemplate(template);
    expect(inputs.every((input) => input.type === "str")).toBe(true);
  });
});

describe("convertHttpComponentConfig", () => {
  it("converts HttpComponentConfig to HttpConfig", () => {
    const config: HttpComponentConfig = {
      name: "Test HTTP",
      description: "Test description",
      url: "https://api.example.com/chat",
      method: "POST",
      bodyTemplate: '{"input": "{{input}}"}',
      outputPath: "$.result",
      timeoutMs: 30000,
      headers: [{ key: "Content-Type", value: "application/json" }],
    };

    const result = convertHttpComponentConfig(config);

    expect(result.url).toBe("https://api.example.com/chat");
    expect(result.method).toBe("POST");
    expect(result.bodyTemplate).toBe('{"input": "{{input}}"}');
    expect(result.outputPath).toBe("$.result");
    expect(result.timeoutMs).toBe(30000);
    expect(result.headers).toEqual([{ key: "Content-Type", value: "application/json" }]);
  });

  it("defaults method to POST when not specified", () => {
    const config: HttpComponentConfig = {
      name: "Test HTTP",
      description: "Test",
      url: "https://api.example.com/chat",
      method: "POST",
    };

    const result = convertHttpComponentConfig(config);
    expect(result.method).toBe("POST");
  });
});

describe("buildHttpAgentTarget", () => {
  it("builds a complete HTTP agent target", () => {
    const target = buildHttpAgentTarget({
      id: "http-1",
      dbAgentId: "db-agent-123",
      httpConfig: {
        url: "https://api.example.com/chat",
        method: "POST",
        bodyTemplate: '{"thread_id": "{{thread_id}}", "input": "{{input}}"}',
        outputPath: "$.result",
      },
    });

    expect(target.id).toBe("http-1");
    expect(target.type).toBe("agent");
    expect(target.agentType).toBe("http");
    expect(target.dbAgentId).toBe("db-agent-123");
    expect(target.inputs.length).toBe(2);
    expect(target.inputs.map((i) => i.identifier)).toContain("thread_id");
    expect(target.inputs.map((i) => i.identifier)).toContain("input");
    expect(target.outputs).toEqual([{ identifier: "output", type: "str" }]);
    expect(target.mappings).toEqual({});
    expect(target.httpConfig).toBeDefined();
  });

  it("extracts inputs from bodyTemplate correctly", () => {
    const target = buildHttpAgentTarget({
      id: "http-2",
      httpConfig: {
        url: "https://api.example.com/chat",
        method: "POST",
        bodyTemplate: '{"messages": {{messages}}, "context": "{{context}}"}',
      },
    });

    expect(target.inputs.length).toBe(2);
    expect(target.inputs.map((i) => i.identifier)).toContain("messages");
    expect(target.inputs.map((i) => i.identifier)).toContain("context");
  });

  it("handles empty bodyTemplate gracefully", () => {
    const target = buildHttpAgentTarget({
      id: "http-3",
      httpConfig: {
        url: "https://api.example.com/chat",
        method: "POST",
        bodyTemplate: undefined,
      },
    });

    expect(target.inputs).toEqual([]);
  });
});
