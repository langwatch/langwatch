// --- Mock setup (must be at the top for Vitest hoisting) ---
const { mockStartActiveSpan } = vi.hoisted(() => ({
  mockStartActiveSpan: vi.fn((name, fn) => fn({
    setType: vi.fn(),
    setInput: vi.fn(),
    setMetrics: vi.fn(),
    setStatus: vi.fn(),
    setOutputEvaluation: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ traceId: 'trace', spanId: 'span' }),
  })),
}));

vi.mock('../tracer', () => ({ tracer: { startActiveSpan: mockStartActiveSpan } }));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('../../client', () => ({
  canAutomaticallyCaptureInput: () => true,
  getApiKey: () => 'test-key',
  getEndpoint: () => 'https://api',
}));

// --- Imports (must be after mocks for Vitest hoisting) ---
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEvaluation } from '../run-evaluation';
import { LangWatchApiError } from '../../internal/api/errors';

const baseProcessed = {
  status: 'processed',
  passed: true,
  score: 1,
  details: 'ok',
  label: 'label',
  cost: { currency: 'USD', amount: 0.1 },
};
const baseSkipped = { status: 'skipped', details: 'skipped' };
const baseError = { status: 'error', details: 'fail', error_type: 'EvalError', traceback: ['trace'] };

const details = {
  name: 'test',
  data: { input: 'foo', output: 'bar' },
  evaluator: 'test-eval',
};

describe('runEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns processed result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...baseProcessed }),
    });
    const result = await runEvaluation(details as any);
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1);
      expect(result.details).toBe('ok');
      expect(result.label).toBe('label');
      expect(result.cost).toEqual({ currency: 'USD', amount: 0.1 });
    } else {
      throw new Error('Expected processed result');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/evaluations/test-eval/evaluate'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns skipped result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...baseSkipped }),
    });
    const result = await runEvaluation(details as any);
    expect(result.status).toBe('skipped');
    expect(result.details).toBe('skipped');
  });

  it('returns error result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...baseError }),
    });
    const result = await runEvaluation(details as any);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.details).toBe('fail');
      expect(result.error_type).toBe('EvalError');
      expect(result.traceback).toEqual(['trace']);
    } else {
      throw new Error('Expected error result');
    }
  });

  it('returns unknown status as error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'weird' }),
    });
    const result = await runEvaluation(details as any);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_type).toBe('UnknownStatus');
      expect(result.details).toContain('Unknown evaluation status');
    } else {
      throw new Error('Expected error result');
    }
  });

  it('throws LangWatchApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}), status: 400, statusText: 'Bad', headers: { get: () => 'application/json' } });
    await expect(runEvaluation(details as any)).rejects.toBeInstanceOf(LangWatchApiError);
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network fail'));
    await expect(runEvaluation(details as any)).rejects.toThrow('network fail');
  });

  it('calls setInput if canAutomaticallyCaptureInput is true', async () => {
    vi.resetModules();
    vi.doMock('../../client', () => ({
      canAutomaticallyCaptureInput: () => true,
      getApiKey: () => 'test-key',
      getEndpoint: () => 'https://api',
    }));
    const span = {
      setType: vi.fn(),
      setInput: vi.fn(),
      setMetrics: vi.fn(),
      setOutputEvaluation: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      spanContext: () => ({ traceId: 'trace', spanId: 'span' }),
    };
    mockStartActiveSpan.mockImplementationOnce((name, fn) => fn(span));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...baseProcessed }) });
    const { runEvaluation: runEval } = await import('../run-evaluation.js');
    await runEval(details as any);
    expect(span.setInput).toHaveBeenCalledWith(expect.objectContaining({ trace_id: 'trace' }));
  });

  it('does not call setInput if canAutomaticallyCaptureInput is false', async () => {
    vi.resetModules();
    vi.doMock('../../client', () => ({
      canAutomaticallyCaptureInput: () => false,
      getApiKey: () => 'test-key',
      getEndpoint: () => 'https://api',
    }));
    const span = {
      setType: vi.fn(),
      setInput: vi.fn(),
      setMetrics: vi.fn(),
      setOutputEvaluation: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      spanContext: () => ({ traceId: 'trace', spanId: 'span' }),
    };
    mockStartActiveSpan.mockImplementationOnce((name, fn) => fn(span));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...baseProcessed }) });
    const { runEvaluation: runEval } = await import('../run-evaluation.js');
    await runEval(details as any);
    expect(span.setInput).not.toHaveBeenCalled();
  });
});
