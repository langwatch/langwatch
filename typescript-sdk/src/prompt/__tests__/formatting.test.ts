import { describe, it, expect } from 'vitest';
import { formatPromptTemplate, formatPromptMessages, formatPromptMessage, MissingPromptVariableError } from '../formatting';


describe('formatPromptTemplate', () => {
  it('replaces variables in template', () => {
    const template = 'Hello, {{ name }}!';
    const result = formatPromptTemplate(template, { name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  it('throws MissingPromptVariableError if variable is missing', () => {
    const template = 'Hello, {{ name }}!';
    expect(() => formatPromptTemplate(template, {})).toThrow(MissingPromptVariableError);
  });

  it('works with multiple variables', () => {
    const template = 'Hi {{ first }}, meet {{ second }}.';
    const result = formatPromptTemplate(template, { first: 'Alice', second: 'Bob' });
    expect(result).toBe('Hi Alice, meet Bob.');
  });
});

describe('formatPromptMessages', () => {
  it('formats all messages in array', () => {
    const messages = [
      { role: 'user', content: 'Hello, {{ name }}!' },
      { role: 'assistant', content: 'Hi, {{ name }}.' },
    ];
    const result = formatPromptMessages(messages, { name: 'World' });
    expect(result[0]?.content).toBe('Hello, World!');
    expect(result[1]?.content).toBe('Hi, World.');
  });

  it('throws on missing variable in any message', () => {
    const messages = [
      { role: 'user', content: 'Hello, {{ name }}!' },
      { role: 'assistant', content: 'Hi, {{ name }}.' },
    ];
    expect(() => formatPromptMessages(messages, {})).toThrow(MissingPromptVariableError);
  });
});

describe('formatPromptMessage', () => {
  it('formats a single message', () => {
    const message = { role: 'user', content: 'Hi, {{ who }}!' };
    const result = formatPromptMessage(message, { who: 'Bob' });
    expect(result.content).toBe('Hi, Bob!');
    expect(result.role).toBe('user');
  });
});

describe('MissingPromptVariableError', () => {
  it('contains missing variable names in the message', () => {
    try {
      throw new MissingPromptVariableError(['foo', 'bar']);
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain('foo');
      expect(err.message).toContain('bar');
    }
  });
});
