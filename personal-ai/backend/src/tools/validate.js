// Tiny JSON-schema checker for tool inputs. AI models sometimes send wrong or
// missing arguments, so every tool input is checked before anything runs.
// Supports: type object/string/integer/number/boolean, properties, required,
// enum, minimum, maximum, maxLength.

export class ToolInputError extends Error {}

export function validate(schema, input, path = "input") {
  if (schema.type === "object") {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ToolInputError(`${path} must be an object`);
    }
    for (const key of schema.required ?? []) {
      if (input[key] === undefined || input[key] === null) throw new ToolInputError(`${path}.${key} is required`);
    }
    const out = {};
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (input[key] !== undefined && input[key] !== null) out[key] = validate(sub, input[key], `${path}.${key}`);
    }
    return out;
  }
  let value = input;
  // Small local models often send numbers as strings ("40"); accept that.
  if ((schema.type === "integer" || schema.type === "number") && typeof value === "string" && value.trim() !== "") {
    value = Number(value);
  }
  if (schema.type === "boolean" && (value === "true" || value === "false")) value = value === "true";

  const typeOk = {
    string: typeof value === "string",
    integer: Number.isInteger(value),
    number: typeof value === "number" && Number.isFinite(value),
    boolean: typeof value === "boolean",
  }[schema.type];
  if (!typeOk) throw new ToolInputError(`${path} must be a ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) {
    throw new ToolInputError(`${path} must be one of: ${schema.enum.join(", ")}`);
  }
  if (schema.minimum !== undefined && value < schema.minimum) throw new ToolInputError(`${path} must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) throw new ToolInputError(`${path} must be <= ${schema.maximum}`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    throw new ToolInputError(`${path} is too long (max ${schema.maxLength} characters)`);
  }
  return value;
}
