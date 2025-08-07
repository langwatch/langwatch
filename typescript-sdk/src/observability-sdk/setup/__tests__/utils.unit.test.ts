import { describe, it, expect } from 'vitest';
import * as utils from '../utils';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { DEFAULT_SERVICE_NAME } from '../constants';

describe('utils.ts', () => {
  describe('isConcreteProvider', () => {
    it('returns true for null/undefined', () => {
      expect(utils.isConcreteProvider(null)).toBe(false);
      expect(utils.isConcreteProvider(undefined)).toBe(false);
    });
    it('returns true for non-object', () => {
      expect(utils.isConcreteProvider(42)).toBe(false);
      expect(utils.isConcreteProvider('foo')).toBe(false);
    });
    it('returns true for object without addSpanProcessor', () => {
      expect(utils.isConcreteProvider({})).toBe(false);
      expect(utils.isConcreteProvider({ foo: 1 })).toBe(false);
    });
    it('returns false for object with addSpanProcessor function', () => {
      expect(utils.isConcreteProvider({ addSpanProcessor: () => {} })).toBe(true);
    });
  });

  describe('createMergedResource', () => {
    it('merges attributes, serviceName, and givenResource', () => {
      const attributes = { foo: 'bar', bar: 1 };
      const serviceName = 'my-service';
      const givenResource = resourceFromAttributes({ baz: 'qux' });
      const merged = utils.createMergedResource(attributes, serviceName, givenResource);
      expect(merged.attributes['foo']).toBe('bar');
      expect(merged.attributes['bar']).toBe(1);
      expect(merged.attributes['baz']).toBe('qux');
      expect(merged.attributes['service.name']).toBe('my-service');
    });
    it('uses default service name if not provided', () => {
      const merged = utils.createMergedResource(undefined, undefined, undefined);
      expect(merged.attributes['service.name']).toBe(DEFAULT_SERVICE_NAME);
    });
    it('handles undefined attributes and givenResource', () => {
      const merged = utils.createMergedResource(undefined, 'svc', undefined);
      expect(merged.attributes['service.name']).toBe('svc');
    });
    it('does not mutate the givenResource', () => {
      const givenResource = resourceFromAttributes({ foo: 'bar' });
      const merged = utils.createMergedResource({ bar: 'baz' }, 'svc', givenResource);
      expect(givenResource.attributes).toEqual({ foo: 'bar' });
      expect(merged.attributes['bar']).toBe('baz');
    });
  });
});
