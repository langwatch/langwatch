// --- Mock setup (must be at the top for Vitest hoisting) ---
const { mockStartActiveSpan } = vi.hoisted(() => ({
  mockStartActiveSpan: vi.fn((name, fn) => fn({
    setType: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('../tracer', () => ({ tracer: { startActiveSpan: mockStartActiveSpan } }));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('../client', () => ({
  canAutomaticallyCaptureInput: () => true,
  getApiKey: () => 'test-key',
  getEndpoint: () => 'https://api',
}));

vi.mock('../formatting', () => ({
  formatPromptTemplate: vi.fn((template, vars) => template + JSON.stringify(vars)),
  formatPromptMessages: vi.fn((messages: any[], vars: any) =>
    messages.map((m: any) => ({ ...m, content: m.content + JSON.stringify(vars) }))
  ),
}));

// --- Imports (must be after mocks for Vitest hoisting) ---
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPromptVersion } from '../get-prompt-version';

// --- Test data ---
const baseVersion = {
  id: 'ver1',
  authorId: 'author',
  projectId: 'proj',
  configId: 'cfg',
  schemaVersion: '1',
  commitMessage: 'msg',
  version: 2,
  createdAt: 'now',
  configData: {
    version: 2,
    prompt: 'prompt',
    messages: [{ role: 'user', content: 'hi' }],
    inputs: [],
    outputs: [],
    model: 'gpt',
    temperature: 0,
    max_tokens: 0,
    demonstrations: { columns: [], rows: [] },
    prompting_technique: { ref: '' },
  },
};

// --- Tests ---
describe('getPromptVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and returns prompt version, formats with variables', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [baseVersion],
    });
    const result = await getPromptVersion('cfg', 'ver1', { foo: 'bar' });
    expect(result.id).toBe('cfg');
    expect(result.prompt).toContain('foo');
    expect(result.messages[0]?.content).toContain('foo');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/prompts/cfg/versions'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws if version not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ...baseVersion, id: 'other' }],
    });
    await expect(getPromptVersion('cfg', 'ver1')).rejects.toThrow('Prompt version:ver1 not found');
  });

  it('throws LangWatchApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}), status: 400 });
    const LangWatchApiError = (await vi.importActual<any>("../../internal/api/errors")).LangWatchApiError;
    await expect(getPromptVersion('cfg', 'ver1')).rejects.toBeInstanceOf(LangWatchApiError);
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network fail'));
    await expect(getPromptVersion('cfg', 'ver1')).rejects.toThrow('network fail');
  });
});
