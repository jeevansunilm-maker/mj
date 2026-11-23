import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolInputError, validate } from "../src/tools/validate.js";

const schema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["get", "set"] },
    level: { type: "integer", minimum: 0, maximum: 100 },
    note: { type: "string", maxLength: 5 },
  },
  required: ["action"],
};

test("accepts valid input and drops unknown keys", () => {
  assert.deepEqual(validate(schema, { action: "set", level: 40, extra: 1 }), { action: "set", level: 40 });
});

test("coerces numeric strings from small local models", () => {
  assert.deepEqual(validate(schema, { action: "set", level: "55" }), { action: "set", level: 55 });
});

test("rejects bad input", () => {
  for (const bad of [{}, { action: "boom" }, { action: "set", level: 101 }, { action: "set", level: 1.5 }, { action: "get", note: "toolong" }, null, "x"]) {
    assert.throws(() => validate(schema, bad), ToolInputError, JSON.stringify(bad));
  }
});
