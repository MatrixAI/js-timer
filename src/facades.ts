import type {
  ContextFunction,
  ContextFunctionOptions,
  ContextScope,
  ContextTransform,
} from '@matrixai/contexts';
import { scopeContextFunction, scopeContextMethod } from '@matrixai/contexts';

type Incompatible<Context, Provided> = Context extends unknown
  ? {
      [
        Key in keyof Context & keyof Provided
      ]: Provided[Key] extends Context[Key] ? never : Key;
    }[keyof Context & keyof Provided]
  : never;

type FacadeCompatibility<Context, Needs, Provided> = [Context] extends [Needs]
  ? [Incompatible<Context, Provided>] extends [never]
    ? unknown
    : never
  : never;

/**
 * Adapt one timing scope to signature-preserving functions and standard methods.
 * The context argument remains part of the public signature; optional provider
 * fields let callers omit capabilities that the scope supplies. Use the scope
 * directly when requirements must be removed from an operation's input type.
 */
function createTimingFacades<Context extends object>() {
  return function <Needs extends object, Provided extends object>(
    scope: ContextScope<Needs, Provided> &
      FacadeCompatibility<Context, Needs, Provided>,
  ) {
    // The compatibility check rejects stronger overlapping fields. The scope
    // itself performs record validation, projection, and all resource ownership.
    const transform = scope as unknown as ContextTransform<Context, Context>;
    return {
      function<
        This,
        Args extends unknown[],
        Result,
        const Position extends number | 'last',
      >(
        operation: Parameters<
          typeof scopeContextFunction<Context, This, Args, Result, Position>
        >[0],
        options: ContextFunctionOptions<Position>,
      ): ContextFunction<This, Args, Result> {
        return scopeContextFunction<Context, This, Args, Result, Position>(
          operation,
          transform,
          options,
        );
      },
      method<const Position extends number | 'last'>(
        options: ContextFunctionOptions<Position>,
      ) {
        return scopeContextMethod<Context, Position>(transform, options);
      },
    };
  };
}

export { createTimingFacades };
