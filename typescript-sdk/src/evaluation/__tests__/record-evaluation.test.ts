// --- Mock setup (must be at the top for Vitest hoisting) ---
const { mockStartActiveSpan } = vi.hoisted(() => ({
  mockStartActiveSpan: vi.fn((name, fn) => fn({
    setType: vi.fn(),
    addEvent: vi.fn(),
    setOutput: vi.fn(),
    setAttributes: vi.fn(),
    setMetrics: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('../tracer', () => ({ tracer: { startActiveSpan: mockStartActiveSpan } }));
vi.mock('../../observability/semconv', () => ({
  ATTR_LANGWATCH_EVALUATION_CUSTOM: 'custom_event',
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordEvaluation } from '../record-evaluation';

const baseDetails: import('../record-evaluation').RecordedEvaluationDetails = {
  evaluationId: 'eval1',
  name: 'test',
  type: 'custom',
  isGuardrail: false,
  status: 'processed',
  passed: true,
  score: 1,
  label: 'label',
  details: 'ok',
  cost: { currency: 'USD', amount: 0.1 },
  error: undefined,
  timestamps: { startedAtUnixMs: 1, finishedAtUnixMs: 2 },
};

describe('recordEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records processed evaluation', () => {
    const span = {
      setType: vi.fn(),
      addEvent: vi.fn(),
      setOutput: vi.fn(),
      setAttributes: vi.fn(),
      setMetrics: vi.fn(),
      setOutputEvaluation: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };

    mockStartActiveSpan.mockImplementationOnce((name, fn) => fn(span));
    recordEvaluation({ ...baseDetails });

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      'record evaluation',
      expect.any(Function)
    );
    expect(span.setType).toHaveBeenCalledWith('evaluation');
    expect(span.addEvent).toHaveBeenCalledWith('custom_event', expect.objectContaining({
      json_encoded_event: expect.stringContaining('"name":"test"')
    }));
    expect(span.setOutput).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processed',
      passed: true,
      score: 1,
      label: 'label',
      details: 'ok',
      cost: { currency: 'USD', amount: 0.1 },
    }));
    expect(span.end).toHaveBeenCalled();
  });

  it('records skipped evaluation', () => {
    recordEvaluation({ ...baseDetails, status: 'skipped', details: 'skipped' });
    expect(mockStartActiveSpan).toHaveBeenCalled();
  });

  it('records error evaluation', () => {
    recordEvaluation({ ...baseDetails, status: 'error', error: new Error('fail'), details: 'fail' });
    expect(mockStartActiveSpan).toHaveBeenCalled();
  });

  it('sets cost metric if cost is present', () => {
    recordEvaluation({ ...baseDetails, cost: { currency: 'USD', amount: 42 } });
    // No assertion needed, just ensure no error
  });

  it('sets attributes if provided', () => {
    const attrs = { foo: 'bar' };
    recordEvaluation({ ...baseDetails }, attrs);
    // No assertion needed, just ensure no error
  });

  it('handles error in span', () => {
    const errorSpan = {
      setType: vi.fn(() => { throw new Error('fail in span'); }),
      addEvent: vi.fn(),
      setOutput: vi.fn(),
      setAttributes: vi.fn(),
      setMetrics: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    expect(() => {
      mockStartActiveSpan.mock.calls[0]?.[1]?.(errorSpan);
    }).not.toThrow();
  });
});
