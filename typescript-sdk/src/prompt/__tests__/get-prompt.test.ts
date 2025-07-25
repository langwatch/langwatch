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
import { getPrompt } from '../get-prompt';

// --- Test data ---
const basePrompt = {
  id: 'id',
  name: 'name',
  updatedAt: 'now',
  version: 1,
  versionId: 'v1',
  versionCreatedAt: 'now',
  model: 'gpt',
  prompt: 'prompt',
  messages: [{ role: 'user', content: 'hi' }],
  response_format: null,
};

// --- Tests ---
describe('getPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and returns prompt, formats with variables', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...basePrompt }),
    });
    const result = await getPrompt('id', { foo: 'bar' });
    expect(result.id).toBe('id');
    expect(result.prompt).toContain('foo');
    expect(result.messages[0]?.content).toContain('foo');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/prompts/id'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws LangWatchApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}), status: 400 });
    const LangWatchApiError = (await vi.importActual<any>("../../internal/api/errors")).LangWatchApiError;
    await expect(getPrompt('id')).rejects.toBeInstanceOf(LangWatchApiError);
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network fail'));
    await expect(getPrompt('id')).rejects.toThrow('network fail');
  });
});
