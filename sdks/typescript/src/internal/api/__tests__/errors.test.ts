import { describe, it, expect, vi } from 'vitest';
import { LangWatchApiError } from '../errors';

describe('LangWatchApiError', () => {
  it('creates error with message and response', () => {
    const mockResponse = {
      status: 400,
      statusText: 'Bad Request'
    } as Response;

    const error = new LangWatchApiError('Test error message', mockResponse);
    expect(error.message).toBe('Test error message');
    expect(error.name).toBe('Error');
    expect(error.httpStatus).toBe(400);
    expect(error.httpStatusText).toBe('Bad Request');
  });

  it('inherits from Error', () => {
    const mockResponse = { status: 500, statusText: 'Internal Server Error' } as Response;
    const error = new LangWatchApiError('Test error', mockResponse);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LangWatchApiError);
  });

  it('has stack trace', () => {
    const mockResponse = { status: 404, statusText: 'Not Found' } as Response;
    const error = new LangWatchApiError('Test error', mockResponse);
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });

  it('parses JSON response body', async () => {
    const mockResponse = {
      status: 400,
      statusText: 'Bad Request',
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockResolvedValue({ error: 'Invalid API key' })
    } as unknown as Response;

    const error = new LangWatchApiError('Bad request', mockResponse);
    await error.safeParseBody(mockResponse);

    expect(error.body).toEqual({ error: 'Invalid API key' });
    expect(error.apiError).toBe('Invalid API key');
  });

  it('parses text response body for non-JSON content', async () => {
    const mockResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        get: vi.fn().mockReturnValue('text/plain')
      },
      text: vi.fn().mockResolvedValue('Server error occurred')
    } as unknown as Response;

    const error = new LangWatchApiError('Server error', mockResponse);
    await error.safeParseBody(mockResponse);

    expect(error.body).toBe('Server error occurred');
    expect(error.apiError).toBeUndefined();
  });

  it('handles parsing errors gracefully', async () => {
    const mockResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockRejectedValue(new Error('Parse error'))
    } as unknown as Response;

    const error = new LangWatchApiError('Server error', mockResponse);
    await error.safeParseBody(mockResponse);

    expect(error.body).toBe(null);
  });

  it('handles JSON without error field', async () => {
    const mockResponse = {
      status: 400,
      statusText: 'Bad Request',
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockResolvedValue({ message: 'Something went wrong' })
    } as unknown as Response;

    const error = new LangWatchApiError('Bad request', mockResponse);
    await error.safeParseBody(mockResponse);

    expect(error.body).toEqual({ message: 'Something went wrong' });
    expect(error.apiError).toBeUndefined();
  });
});
