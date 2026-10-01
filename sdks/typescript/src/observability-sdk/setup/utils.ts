import { type Attributes } from "@opentelemetry/api";
import { defaultResource, type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import * as semconv from "@opentelemetry/semantic-conventions/incubating";

import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_VERSION,
  DEFAULT_SERVICE_NAME,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
} from "../../internal/constants";
import {
  ATTR_LANGWATCH_SDK_NAME,
  ATTR_LANGWATCH_SDK_VERSION,
  ATTR_LANGWATCH_SDK_LANGUAGE,
} from "../semconv/attributes";

/**
 * Creates a merged resource from the given attributes, service name, and given resource.
 */
export function createMergedResource(
  attributes: Attributes | undefined,
  serviceName: string | undefined,
  givenResource: Resource | undefined,
): Resource {
  const langwatchResource = resourceFromAttributes({
    [ATTR_LANGWATCH_SDK_NAME]: LANGWATCH_SDK_NAME_OBSERVABILITY,
    [ATTR_LANGWATCH_SDK_LANGUAGE]: LANGWATCH_SDK_LANGUAGE,
    [ATTR_LANGWATCH_SDK_VERSION]: LANGWATCH_SDK_VERSION,
  });

  const userResource = resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: serviceName ?? DEFAULT_SERVICE_NAME,
    ...attributes,
  });

  return (givenResource ?? defaultResource()).merge(langwatchResource).merge(userResource);
}

export function readMember(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined;
  return Reflect.get(Object(value), key);
}

export function callMember(target: unknown, key: string, args: unknown[]): unknown {
  const member = readMember(target, key);
  if (typeof member !== "function") throw new TypeError(`${key} is not a function`);
  return Reflect.apply(member, target, args);
}

export function listProcessorRegistryCandidates(provider: unknown): unknown[] {
  return [
    readMember(readMember(provider, "_activeSpanProcessor"), "_spanProcessors"),
    readMember(readMember(provider, "activeSpanProcessor"), "_spanProcessors"),
    readMember(provider, "_registeredSpanProcessors"),
  ];
}

function hasAttachableProcessorRegistry(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  return listProcessorRegistryCandidates(obj).some(Array.isArray);
}

function isConcreteProviderName(name: unknown): boolean {
  return typeof name === "string" && ["NodeTracerProvider", "BasicTracerProvider"].includes(name);
}

/**
 * Returns the concrete OpenTelemetry provider (NodeTracerProvider or BasicTracerProvider),
 * either from the given provider or its delegate, or undefined if not found.
 */
export function getConcreteProvider(provider: unknown): unknown {
  if (!provider || typeof provider !== "object") return undefined;

  // Check provider itself
  const constructorName = readMember(provider.constructor, "name");
  if (isConcreteProviderName(constructorName)) {
    return provider;
  }
  if (typeof readMember(provider, "addSpanProcessor") === "function") {
    return provider;
  }
  if (hasAttachableProcessorRegistry(provider)) {
    return provider;
  }

  // Check one level of delegate (ProxyTracerProvider pattern)
  let delegate: unknown;
  if (typeof readMember(provider, "getDelegate") === "function") {
    delegate = callMember(provider, "getDelegate", []);
  } else if (readMember(provider, "delegate")) {
    delegate = readMember(provider, "delegate");
  } else if (readMember(provider, "_delegate")) {
    // Also check for _delegate (OpenTelemetry's actual property name)
    // See: https://github.com/langwatch/langwatch/issues/753
    delegate = readMember(provider, "_delegate");
  }

  if (!delegate || typeof delegate !== "object") return void 0;

  const delegateConstructorName = readMember(delegate.constructor, "name");
  if (isConcreteProviderName(delegateConstructorName)) {
    return delegate;
  }
  if (typeof readMember(delegate, "addSpanProcessor") === "function") {
    return delegate;
  }
  if (hasAttachableProcessorRegistry(delegate)) {
    return delegate;
  }

  return void 0;
}

/**
 * Returns true if the given provider (or its delegate) is a concrete OpenTelemetry provider.
 */
export function isConcreteProvider(provider: unknown): boolean {
  return !!getConcreteProvider(provider);
}
