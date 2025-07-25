// --- Mock setup (must be at the top for Vitest hoisting) ---
const { mockStartActiveSpan } = vi.hoisted(() => ({
  mockStartActiveSpan: vi.fn((name, fn) => fn({
    setType: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('../tracer', () => ({ tracer: { startActiveSpan: mockStartActiveSpan } }));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('getPrompt (capture disabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not set variables attribute if canAutomaticallyCaptureInput is false', async () => {
    vi.resetModules();
    vi.doMock('../../client', () => ({
      canAutomaticallyCaptureInput: () => false,
      getApiKey: () => 'test-key',
      getEndpoint: () => 'https://api',
    }));
    const span = {
      setType: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    mockStartActiveSpan.mockImplementationOnce((name, fn) => fn(span));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...basePrompt }) });
    const { getPrompt } = await import('../get-prompt');
    await getPrompt('id', { foo: 'bar' });
    // Ensure no call to setAttribute with the variables key and value
    const calls = (span.setAttribute as any).mock.calls;
    expect(calls.some(([key, value]: [any, any]) => key === 'langwatch.prompt.variables' && value.includes('foo'))).toBe(false);
  });
});
